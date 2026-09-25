"""
Testes unitários para a camada de transportes do Kôma Print.
Cobre BluetoothRfcommTransport, UsbDirectTransport, CupsTransport e WindowsSpoolerTransport.
"""

from unittest.mock import MagicMock, call, patch
import socket
import pytest

from adapters.transports import (
    PrinterTransport,
    BluetoothRfcommTransport,
    UsbDirectTransport,
    CupsTransport,
    WindowsSpoolerTransport,
)


class TestBluetoothRfcommTransport:
    def test_normalize_address(self):
        assert BluetoothRfcommTransport.normalize_address("86:67:7A:6B:30:C4") == "86:67:7A:6B:30:C4"
        assert BluetoothRfcommTransport.normalize_address("86677a6b30c4") == "86:67:7A:6B:30:C4"
        assert BluetoothRfcommTransport.normalize_address("bluetooth://86:67:7A:6B:30:C4") == "86:67:7A:6B:30:C4"
        assert BluetoothRfcommTransport.normalize_address("bluetooth://86677a6b30c4?channel=1") == "86:67:7A:6B:30:C4"

    def test_is_available_validation(self):
        valid = BluetoothRfcommTransport("86:67:7A:6B:30:C4")
        assert valid.is_available() is True

        empty = BluetoothRfcommTransport("")
        assert empty.is_available() is False

        invalid = BluetoothRfcommTransport("invalid-mac")
        assert invalid.is_available() is False

    def test_send_success_in_chunks_with_socket_closed(self):
        mock_sock = MagicMock()
        transport = BluetoothRfcommTransport(
            address="86:67:7A:6B:30:C4",
            channel=1,
            timeout=5.0,
            chunk_size=10,
            chunk_delay_s=0.001,
            socket_factory=lambda: mock_sock,
        )

        data = b"0123456789abcdefghij"  # 20 bytes -> 2 chunks of 10
        with patch("adapters.transports.time.sleep") as mock_sleep:
            result = transport.send(data)

        assert result is True
        mock_sock.settimeout.assert_called_once_with(5.0)
        mock_sock.connect.assert_called_once_with(("86:67:7A:6B:30:C4", 1))
        assert mock_sock.sendall.call_count == 2
        mock_sock.sendall.assert_has_calls([
            call(b"0123456789"),
            call(b"abcdefghij"),
        ])
        mock_sleep.assert_called_once_with(0.001)
        mock_sock.close.assert_called_once()

    def test_send_empty_payload_returns_true_without_connecting(self):
        mock_sock = MagicMock()
        transport = BluetoothRfcommTransport(
            address="86:67:7A:6B:30:C4",
            socket_factory=lambda: mock_sock,
        )
        assert transport.send(b"") is True
        mock_sock.connect.assert_not_called()

    def test_send_missing_address_returns_false(self):
        transport = BluetoothRfcommTransport(address="")
        assert transport.send(b"test") is False

    def test_send_connection_timeout(self):
        mock_sock = MagicMock()
        mock_sock.connect.side_effect = socket.timeout("timed out")
        transport = BluetoothRfcommTransport(
            address="86:67:7A:6B:30:C4",
            socket_factory=lambda: mock_sock,
        )

        result = transport.send(b"some data")
        assert result is False
        mock_sock.close.assert_called_once()

    def test_send_connection_refused(self):
        mock_sock = MagicMock()
        mock_sock.connect.side_effect = ConnectionRefusedError("connection refused")
        transport = BluetoothRfcommTransport(
            address="86:67:7A:6B:30:C4",
            socket_factory=lambda: mock_sock,
        )

        result = transport.send(b"some data")
        assert result is False
        mock_sock.close.assert_called_once()

    def test_send_partial_failure_during_sendall(self):
        mock_sock = MagicMock()
        mock_sock.sendall.side_effect = [None, OSError("broken pipe")]
        transport = BluetoothRfcommTransport(
            address="86:67:7A:6B:30:C4",
            chunk_size=10,
            socket_factory=lambda: mock_sock,
        )

        data = b"0123456789abcdefghij"
        result = transport.send(data)
        assert result is False
        assert mock_sock.sendall.call_count == 2
        mock_sock.close.assert_called_once()


class TestUsbDirectTransport:
    def test_send_writes_and_flushes(self, tmp_path):
        port_file = tmp_path / "lp0"
        transport = UsbDirectTransport(str(port_file))

        result = transport.send(b"hello usb")
        assert result is True
        assert port_file.read_bytes() == b"hello usb"

    def test_send_io_error_returns_false(self):
        transport = UsbDirectTransport("/nonexistent/directory/lp0")
        assert transport.send(b"hello") is False

    def test_is_available(self, tmp_path):
        port_file = tmp_path / "lp0"
        port_file.touch()
        transport = UsbDirectTransport(str(port_file))
        assert transport.is_available() is True

        missing = UsbDirectTransport(str(tmp_path / "missing"))
        assert missing.is_available() is False


class TestCupsTransport:
    def test_send_success(self):
        transport = CupsTransport("G250")
        with patch("adapters.transports.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout=b"request id 1", stderr=b"")
            assert transport.send(b"escpos data") is True
            mock_run.assert_called_once_with(
                ["lp", "-d", "G250", "-o", "raw"],
                input=b"escpos data",
                stdout=-1,
                stderr=-1,
                timeout=15.0,
                check=False,
            )

    def test_send_failure_on_non_zero_returncode(self):
        transport = CupsTransport("G250")
        with patch("adapters.transports.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1, stdout=b"", stderr=b"queue disabled")
            assert transport.send(b"escpos data") is False


class TestWindowsSpoolerTransport:
    def test_send_success_with_win32print(self):
        transport = WindowsSpoolerTransport("G250")
        mock_win32 = MagicMock()
        mock_win32.OpenPrinter.return_value = 1234
        with patch.dict("sys.modules", {"win32print": mock_win32}):
            assert transport.send(b"windows escpos") is True
            mock_win32.OpenPrinter.assert_called_once_with("G250")
            mock_win32.WritePrinter.assert_called_once_with(1234, b"windows escpos")
            mock_win32.ClosePrinter.assert_called_once_with(1234)

    def test_send_missing_win32print_module(self):
        transport = WindowsSpoolerTransport("G250")
        with patch.dict("sys.modules", {"win32print": None}):
            assert transport.send(b"data") is False
