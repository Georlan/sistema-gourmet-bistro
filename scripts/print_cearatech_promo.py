#!/usr/bin/env python3
"""
Script operacional para emissão física da ficha promocional do KÔMA no Siará Tech Summit 2026.
Permite impressão unitária (ao vivo no palco) ou em lote (20, 30, 50 cópias para networking).
"""

import argparse
import os
import subprocess
import sys
import time

# Adicionar backend ao path para carregar o gerador
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(CURRENT_DIR)
sys.path.insert(0, os.path.join(PROJECT_ROOT, "backend"))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "print-agent"))

# Configurar chaves mínimas para importação caso não estejam no ambiente
os.environ.setdefault("ENVIRONMENT", "operational")
os.environ.setdefault("SECRET_KEY", "operational_koma_cli_secret_key_1234567890")
os.environ.setdefault("ENCRYPTION_KEY", "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=")

from app.services.cearatech_promo_printer import (
    DEFAULT_CANONICAL_URL,
    build_cearatech_promo_escpos,
    generate_cearatech_promo_image,
)
from adapters.transports import BluetoothRfcommTransport


def print_via_bluetooth(data: bytes, address: str = "86:67:7A:6B:30:C4", copies: int = 1) -> int:
    transport = BluetoothRfcommTransport(address, channel=1, timeout=8.0)
    print(f"[BLUETOOTH] Verificando impressora {address}...")
    if not transport.is_available():
        print(f"[BLUETOOTH] Transporte indisponível para {address}.")
        return 0

    if not transport.probe(timeout=3.0):
        print(f"[BLUETOOTH] Impressora {address} não respondeu ao probe.")
        return 0

    print(f"[BLUETOOTH] Impressora conectada! Enviando {copies} cópia(s)...")
    successes = 0
    for i in range(copies):
        print(f"  -> Imprimindo cópia {i + 1}/{copies}...")
        ok = transport.send(data)
        if ok:
            successes += 1
            if i < copies - 1:
                time.sleep(0.5)  # Pequeno respiro entre impressões
        else:
            print(f"  [ERRO] Falha ao enviar cópia {i + 1}")
            break
    return successes


def print_via_cups(data: bytes, queue_name: str, copies: int = 1) -> int:
    print(f"[CUPS] Enviando {copies} cópia(s) para fila '{queue_name}'...")
    successes = 0
    for i in range(copies):
        proc = subprocess.run(
            ["lp", "-d", queue_name, "-o", "raw"],
            input=data,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=5,
            check=False,
        )
        if proc.returncode == 0:
            successes += 1
        else:
            print(f"  [ERRO CUPS] {proc.stderr.decode('utf-8', errors='ignore')}")
            break
    return successes


def main():
    parser = argparse.ArgumentParser(
        description="Emissão da ficha promocional KÔMA para o Siará Tech Summit 2026."
    )
    parser.add_argument(
        "--copies",
        type=int,
        default=1,
        help="Quantidade de cópias a imprimir (ex.: 1 ao vivo, ou lote 20, 30, 50).",
    )
    parser.add_argument(
        "--target-url",
        type=str,
        default=DEFAULT_CANONICAL_URL,
        help=f"URL canônica codificada no QR code (padrão: {DEFAULT_CANONICAL_URL}).",
    )
    parser.add_argument(
        "--preview",
        type=str,
        default="",
        help="Caminho para salvar arquivo PNG de pré-visualização (opcional).",
    )
    parser.add_argument(
        "--transport",
        type=str,
        choices=["auto", "bluetooth", "cups", "none"],
        default="auto",
        help="Canal de impressão a utilizar.",
    )
    parser.add_argument(
        "--bt-address",
        type=str,
        default="86:67:7A:6B:30:C4",
        help="Endereço MAC da impressora Bluetooth (padrão: 86:67:7A:6B:30:C4 / KA-1445).",
    )
    parser.add_argument(
        "--cups-queue",
        type=str,
        default="Kapbom",
        help="Nome da fila CUPS (padrão: Kapbom).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Apenas gera o raster e valida sem disparar na impressora.",
    )

    args = parser.parse_args()

    print(f"=== KÔMA — Ficha Promocional Siará Tech Summit 2026 ===")
    print(f"URL Canônica: {args.target_url}")
    print(f"Cópias solicitadas: {args.copies}")

    # Gerar imagem
    img = generate_cearatech_promo_image(args.target_url)
    print(f"Imagem renderizada: {img.width}x{img.height} dots (monocromática 1-bit)")

    if args.preview:
        img.save(args.preview)
        print(f"Pré-visualização salva em: {args.preview}")

    # Gerar ESC/POS
    escpos_bytes = build_cearatech_promo_escpos(args.target_url)
    print(f"Payload ESC/POS gerado: {len(escpos_bytes)} bytes")

    if args.dry_run or args.transport == "none":
        print("[DRY-RUN] Operação concluída sem envio para o hardware.")
        return

    printed = 0
    if args.transport in ("auto", "bluetooth"):
        printed = print_via_bluetooth(escpos_bytes, address=args.bt_address, copies=args.copies)

    if printed == 0 and args.transport in ("auto", "cups"):
        printed = print_via_cups(escpos_bytes, queue_name=args.cups_queue, copies=args.copies)

    if printed > 0:
        print(f"\n[SUCESSO] {printed}/{args.copies} ficha(s) impressa(s) com sucesso!")
    else:
        print(f"\n[FALHA] Nenhuma cópia pôde ser impressa no hardware físico.")
        sys.exit(1)


if __name__ == "__main__":
    main()
