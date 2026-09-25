"""
Testes para o modelo PrinterEndpoint e configuração estruturada persistente (PR 3).
Cobre:
- Carga de configuração antiga (legada) e nova (estruturada).
- Resolução por destino (PADRAO, COZINHA, BAR, fallback).
- Endpoints com mesmo nome e transportes diferentes (desambiguação e lanes separadas).
- Não perda de configuração em update (preservação de tokens e campos).
- Despacho em lanes separadas via dispatcher com isolamento FIFO por endpoint ID.
- Construção de transportes a partir de endpoints (bluetooth_rfcomm, cups, usb_direct, windows_spooler, tcp).
"""

import json
import os
import sys
from unittest.mock import MagicMock, patch
import pytest

current_dir = os.path.dirname(os.path.abspath(__file__))
agent_dir = os.path.abspath(os.path.join(current_dir, ".."))
if agent_dir not in sys.path:
    sys.path.insert(0, agent_dir)

from config import AgentConfig
from endpoints import PrinterEndpoint, infer_transport_from_target
from adapters.transports import (
    BluetoothRfcommTransport,
    UsbDirectTransport,
    CupsTransport,
    WindowsSpoolerTransport,
    TcpTransport,
)
from dispatcher import dispatch_claimed_jobs, _target_printer


class TestPrinterEndpointModel:
    def test_endpoint_instantiation_defaults(self):
        ep = PrinterEndpoint(name="Cozinha", transport="bluetooth_rfcomm", address="86:67:7A:6B:30:C4")
        assert ep.id.startswith("ep-bluetooth_rfcomm-cozinha")
        assert ep.display_name == "Cozinha"
        assert ep.protocol == "escpos"
        assert ep.options == {}

    def test_endpoint_serialization_roundtrip(self):
        original = PrinterEndpoint(
            id="ep-termica-01",
            name="G250",
            display_name="Térmica Principal",
            transport="cups",
            address="G250_Queue",
            protocol="escpos",
            options={"timeout": 12.0},
        )
        data = original.to_dict()
        restored = PrinterEndpoint.from_dict(data)

        assert restored.id == original.id
        assert restored.name == original.name
        assert restored.display_name == original.display_name
        assert restored.transport == original.transport
        assert restored.address == original.address
        assert restored.options == original.options

    def test_build_transport_for_all_supported_types(self):
        # Bluetooth RFCOMM
        ep_bt = PrinterEndpoint(
            id="ep-bt-1",
            name="KA-1445",
            transport="bluetooth_rfcomm",
            address="86:67:7A:6B:30:C4",
            options={"channel": 1, "timeout": 8.0, "chunk_size": 256},
        )
        t_bt = ep_bt.build_transport()
        assert isinstance(t_bt, BluetoothRfcommTransport)
        assert t_bt.address == "86:67:7A:6B:30:C4"
        assert t_bt.channel == 1
        assert t_bt.chunk_size == 256

        # USB Direct
        ep_usb = PrinterEndpoint(
            id="ep-usb-1",
            name="Direct USB",
            transport="usb_direct",
            address="/dev/usb/lp0",
        )
        t_usb = ep_usb.build_transport()
        assert isinstance(t_usb, UsbDirectTransport)
        assert t_usb.device_path == "/dev/usb/lp0"

        # CUPS
        ep_cups = PrinterEndpoint(
            id="ep-cups-1",
            name="Cozinha CUPS",
            transport="cups",
            address="Cozinha_Fila",
        )
        t_cups = ep_cups.build_transport()
        assert isinstance(t_cups, CupsTransport)
        assert t_cups.queue_name == "Cozinha_Fila"

        # Windows Spooler
        ep_win = PrinterEndpoint(
            id="ep-win-1",
            name="Spooler Windows",
            transport="windows_spooler",
            address="EPSON TM-T20",
        )
        t_win = ep_win.build_transport()
        assert isinstance(t_win, WindowsSpoolerTransport)
        assert t_win.printer_name == "EPSON TM-T20"

        # TCP / Rede
        ep_tcp = PrinterEndpoint(
            id="ep-tcp-1",
            name="Rede Bar",
            transport="tcp",
            address="192.168.1.200:9100",
            options={"timeout": 5.0},
        )
        t_tcp = ep_tcp.build_transport()
        assert isinstance(t_tcp, TcpTransport)
        assert t_tcp.host == "192.168.1.200"
        assert t_tcp.port == 9100
        assert t_tcp.timeout == 5.0


class TestConfigMigrationAndPersistence:
    def test_loads_legacy_config_with_transparent_migration(self, tmp_path):
        legacy_file = tmp_path / "config.json"
        legacy_data = {
            "api_url": "https://api.test",
            "agent_token": "token-xyz",
            "printers": {
                "PADRAO": "G250",
                "COZINHA": "/dev/usb/lp1",
                "BAR": "bluetooth://86:67:7A:6B:30:C4",
            },
        }
        legacy_file.write_text(json.dumps(legacy_data), encoding="utf-8")

        config = AgentConfig.load(str(legacy_file))

        # Retrocompatibilidade de printers legados
        assert config.printers["PADRAO"] == "G250"
        assert config.printers["COZINHA"] == "/dev/usb/lp1"
        assert config.printers["BAR"] == "bluetooth://86:67:7A:6B:30:C4"

        # Migração transparente gerou endpoints estruturados
        assert len(config.endpoints) == 3
        endpoints_by_name = {ep.name: ep for ep in config.endpoints}

        assert "G250" in endpoints_by_name
        assert endpoints_by_name["/dev/usb/lp1"].transport == "usb_direct"
        assert endpoints_by_name["bluetooth://86:67:7A:6B:30:C4"].transport == "bluetooth_rfcomm"

        # Destinos mapeados corretamente
        assert config.destinations["PADRAO"] == endpoints_by_name["G250"].id
        assert config.destinations["COZINHA"] == endpoints_by_name["/dev/usb/lp1"].id
        assert config.destinations["BAR"] == endpoints_by_name["bluetooth://86:67:7A:6B:30:C4"].id

    def test_loads_new_structured_config(self, tmp_path):
        config_file = tmp_path / "config.json"
        new_data = {
            "api_url": "https://api.koma.test",
            "agent_token": "token-123",
            "destinations": {
                "PADRAO": "ep-balcao",
                "COZINHA": "ep-cozinha-bt",
            },
            "endpoints": [
                {
                    "id": "ep-balcao",
                    "name": "G250",
                    "display_name": "Balcão USB",
                    "transport": "cups",
                    "address": "G250",
                },
                {
                    "id": "ep-cozinha-bt",
                    "name": "KA-1445",
                    "display_name": "Cozinha Térmica Bluetooth",
                    "transport": "bluetooth_rfcomm",
                    "address": "86:67:7A:6B:30:C4",
                    "options": {"channel": 1},
                },
            ],
        }
        config_file.write_text(json.dumps(new_data), encoding="utf-8")

        config = AgentConfig.load(str(config_file))

        assert len(config.endpoints) == 2
        assert config.destinations["PADRAO"] == "ep-balcao"
        assert config.destinations["COZINHA"] == "ep-cozinha-bt"

        # Printers mantido em sincronia
        assert config.printers["PADRAO"] == "G250"
        assert config.printers["COZINHA"] == "KA-1445"

    def test_remember_printer_preserves_other_settings_and_updates_structured_config(self, tmp_path):
        config_file = tmp_path / "config.json"
        initial = {
            "api_url": "https://custom.koma.io",
            "agent_token": "secret-preserved-token",
            "destinations": {"BAR": "ep-bar-rede"},
            "endpoints": [
                {
                    "id": "ep-bar-rede",
                    "name": "Bar",
                    "transport": "tcp",
                    "address": "192.168.1.150:9100",
                }
            ],
            "printers": {"BAR": "Bar"},
        }
        config_file.write_text(json.dumps(initial), encoding="utf-8")

        config = AgentConfig.load(str(config_file))
        config.remember_printer("TM-T20")

        # Recarrega do disco
        reloaded = AgentConfig.load(str(config_file))
        assert reloaded.api_url == "https://custom.koma.io"
        assert reloaded.agent_token == "secret-preserved-token"
        assert reloaded.destinations["BAR"] == "ep-bar-rede"
        assert reloaded.printers["BAR"] == "Bar"
        assert reloaded.printers["PADRAO"] == "TM-T20"

        padrao_ep = reloaded.resolve_destination("PADRAO")
        assert padrao_ep is not None
        assert padrao_ep.name == "TM-T20"


class TestDestinationResolution:
    def test_resolves_configured_and_fallback_destinations(self):
        config = AgentConfig()
        ep_padrao = PrinterEndpoint(id="ep-padrao", name="Fila_Padrao", transport="cups", address="Fila_Padrao")
        ep_cozinha = PrinterEndpoint(id="ep-cozinha", name="KA-1445", transport="bluetooth_rfcomm", address="86:67:7A:6B:30:C4")
        ep_bar = PrinterEndpoint(id="ep-bar", name="Bar_TCP", transport="tcp", address="192.168.1.100:9100")

        config.endpoints = [ep_padrao, ep_cozinha, ep_bar]
        config.destinations = {
            "PADRAO": "ep-padrao",
            "COZINHA": "ep-cozinha",
            "BAR": "ep-bar",
        }

        # Destinos exatos
        assert config.resolve_destination("COZINHA") == ep_cozinha
        assert config.resolve_destination("BAR") == ep_bar
        assert config.resolve_destination("PADRAO") == ep_padrao

        # Destinos não configurados recaem em PADRAO
        assert config.resolve_destination("SOBREMESAS") == ep_padrao
        assert config.resolve_destination("CHOPP") == ep_padrao
        assert config.resolve_destination("") == ep_padrao


class TestSameNameDifferentTransportsDisambiguation:
    def test_endpoints_with_same_name_and_different_transports(self, tmp_path):
        """
        Duas impressoras com o mesmo nome amigável 'G250',
        mas uma conectada via USB direto e outra via Bluetooth RFCOMM.
        """
        ep_usb = PrinterEndpoint(
            id="ep-g250-usb",
            name="G250",
            display_name="G250 Balcão (USB)",
            transport="usb_direct",
            address="/dev/usb/lp0",
        )
        ep_bt = PrinterEndpoint(
            id="ep-g250-bluetooth",
            name="G250",
            display_name="G250 Cozinha (Bluetooth)",
            transport="bluetooth_rfcomm",
            address="86:67:7A:6B:30:C4",
        )

        config = AgentConfig()
        config.endpoints = [ep_usb, ep_bt]
        config.destinations = {
            "PADRAO": "ep-g250-usb",
            "COZINHA": "ep-g250-bluetooth",
        }

        # Resolução deve distinguir pelos endpoints
        res_padrao = config.resolve_destination("PADRAO")
        res_cozinha = config.resolve_destination("COZINHA")

        assert res_padrao.id == "ep-g250-usb"
        assert res_padrao.transport == "usb_direct"
        assert res_padrao.address == "/dev/usb/lp0"

        assert res_cozinha.id == "ep-g250-bluetooth"
        assert res_cozinha.transport == "bluetooth_rfcomm"
        assert res_cozinha.address == "86:67:7A:6B:30:C4"

        # Dispatcher deve separar em lanes físicas distintas e chamar os transportes corretos
        mock_adapter = MagicMock()
        mock_adapter.print_ticket.return_value = True
        mock_journal = MagicMock()
        mock_journal.is_printed.return_value = False

        jobs = [
            {"id": "job-1", "destination": "PADRAO", "payload_text": "Cupom Balcão"},
            {"id": "job-2", "destination": "COZINHA", "payload_text": "Pedido Cozinha"},
            {"id": "job-3", "destination": "PADRAO", "payload_text": "Cupom 2 Balcão"},
        ]

        outcomes = dispatch_claimed_jobs(
            mock_adapter,
            mock_journal,
            jobs,
            config,
            max_parallel_printers=2,
        )

        assert len(outcomes) == 3
        # O adapter recebeu os objetos PrinterEndpoint diretamente no lugar do nome
        calls = mock_adapter.print_ticket.call_args_list
        assert len(calls) == 3

        passed_targets = [call[0][1] for call in calls]
        assert ep_usb in passed_targets
        assert ep_bt in passed_targets

        # O diário gravou com o nome legível
        journal_calls = mock_journal.record_print_success.call_args_list
        assert len(journal_calls) == 3
        for call in journal_calls:
            assert call[0][2] == "G250"  # printer_name preservado
