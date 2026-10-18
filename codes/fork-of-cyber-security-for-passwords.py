#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SOVEREIGN-X PORTABLE SECURITY & SIGNAL ANALYZER v5.0
=====================================================
Production-grade single-file security tool for small devices.

SECURITY FEATURES:
- AES-256-GCM authenticated encryption
- PBKDF2-HMAC-SHA256 (600k iterations) or optional Argon2id
- hmac.compare_digest for constant-time comparison
- Auto-lock after inactivity
- Panic mode with self-destruct
- Encrypted export/import
- Isolated test suite via tempfile

USAGE:
    python sovereignx.py              # Run normally
    python sovereignx.py --test       # Run isolated tests

REQUIREMENTS:
    pip install cryptography
    # Optional for Argon2id:
    pip install argon2-cffi
"""

import os
import sys
import json
import time
import math
import sqlite3
import hashlib
import secrets
import string
import logging
import getpass
import subprocess
import re
import threading
import hmac
import tempfile
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass
from typing import List, Dict, Optional, Tuple
from contextlib import contextmanager

# ============================================================
# CRYPTOGRAPHY IMPORTS
# ============================================================
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False
    print("[FATAL] cryptography library not installed!")
    print("Run: pip install cryptography")
    sys.exit(1)

# Optional Argon2id support via argon2-cffi
try:
    from argon2.low_level import hash_secret_raw, Type
    ARGON2_AVAILABLE = True
except ImportError:
    ARGON2_AVAILABLE = False

# ============================================================
# CONFIGURATION
# ============================================================
class Config:
    APP_NAME = "SovereignX-Security"
    VERSION = "5.0.0"
    BASE_DIR = Path.home() / ".sovereignx"
    DB_PATH = BASE_DIR / "sovereignx.db"
    LOG_PATH = BASE_DIR / "logs" / "sovereignx.log"
    KEY_FILE = BASE_DIR / ".master_key"

    # KDF Settings
    # PBKDF2 is the default (NIST-approved, widely compatible)
    # Argon2id is used if argon2-cffi is installed AND algorithm is set to "argon2id"
    KDF_ALGORITHM = "pbkdf2"        # "pbkdf2" or "argon2id"
    PBKDF2_ITERATIONS = 600_000     # OWASP recommendation for PBKDF2-HMAC-SHA256
    ARGON2_TIME_COST = 3            # Argon2id iterations
    ARGON2_MEMORY = 65536           # KiB (64 MB)
    ARGON2_PARALLELISM = 4          # Threads

    # App settings
    LOCK_TIMEOUT = 300              # seconds
    SIGNAL_SCAN_INTERVAL = 5
    MAX_SIGNAL_HISTORY = 1000
    SCREEN_WIDTH = 40
    SCREEN_HEIGHT = 20
    MAX_FAILED_LOGINS = 5           # Self-destruct trigger

    @classmethod
    def ensure_dirs(cls):
        cls.BASE_DIR.mkdir(parents=True, exist_ok=True)
        (cls.BASE_DIR / "logs").mkdir(parents=True, exist_ok=True)

# ============================================================
# LOGGING
# ============================================================
Config.ensure_dirs()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(Config.LOG_PATH),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# ============================================================
# DATABASE
# ============================================================
class Database:
    """
    SQLite database with metadata table for KDF versioning and panic code storage.
    Supports custom base_dir for isolated testing.
    """

    def __init__(self, base_dir: Path = None):
        if base_dir is None:
            base_dir = Config.BASE_DIR
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.base_dir / "sovereignx.db"
        self._init_db()

    @contextmanager
    def _connect(self):
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            logger.error(f"Database error: {e}")
            raise
        finally:
            conn.close()

    def _init_db(self):
        with self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS db_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS passwords (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    service TEXT NOT NULL,
                    username TEXT,
                    encrypted_password TEXT NOT NULL,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS signal_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    signal_type TEXT NOT NULL,
                    ssid TEXT,
                    bssid TEXT,
                    rssi INTEGER,
                    frequency REAL,
                    estimated_distance REAL,
                    distance_confidence TEXT,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS map_points (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    latitude REAL,
                    longitude REAL,
                    altitude REAL,
                    label TEXT,
                    signal_id INTEGER,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (signal_id) REFERENCES signal_history(id)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS auth_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    action TEXT NOT NULL,
                    status TEXT NOT NULL,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            logger.info("Database initialized")

    def get_metadata(self, key: str) -> Optional[str]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT value FROM db_metadata WHERE key = ?", (key,)
            ).fetchone()
            return row["value"] if row else None

    def set_metadata(self, key: str, value: str):
        with self._connect() as conn:
            conn.execute("""
                INSERT INTO db_metadata (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """, (key, value))

    def cleanup_old_signals(self):
        with self._connect() as conn:
            conn.execute("""
                DELETE FROM signal_history WHERE id NOT IN 
                (SELECT id FROM signal_history ORDER BY timestamp DESC LIMIT ?)
            """, (Config.MAX_SIGNAL_HISTORY,))

    def wipe_all_data(self):
        """Securely wipe all tables - Panic/Self-destruct mode."""
        with self._connect() as conn:
            conn.execute("DELETE FROM passwords")
            conn.execute("DELETE FROM signal_history")
            conn.execute("DELETE FROM map_points")
            conn.execute("DELETE FROM auth_log")
            conn.execute("DELETE FROM db_metadata")
        logger.critical("ALL DATABASE DATA WIPED")

    def export_encrypted(self, encryption) -> dict:
        """Export all data as an encrypted JSON bundle."""
        with self._connect() as conn:
            passwords = [dict(r) for r in conn.execute("SELECT * FROM passwords").fetchall()]
            signals = [dict(r) for r in conn.execute("SELECT * FROM signal_history").fetchall()]
            points = [dict(r) for r in conn.execute("SELECT * FROM map_points").fetchall()]
            meta = {r["key"]: r["value"] for r in conn.execute("SELECT * FROM db_metadata").fetchall()}
        bundle = {
            "version": Config.VERSION,
            "exported_at": datetime.now().isoformat(),
            "metadata": meta,
            "passwords": passwords,
            "signals": signals,
            "points": points
        }
        return {"encrypted": encryption.encrypt(json.dumps(bundle, ensure_ascii=False))}

    def import_encrypted(self, encrypted_bundle: dict, encryption):
        """Import encrypted JSON bundle. Ignores original IDs to avoid conflicts."""
        bundle = json.loads(encryption.decrypt(encrypted_bundle["encrypted"]))
        with self._connect() as conn:
            for p in bundle.get("passwords", []):
                conn.execute("""
                    INSERT INTO passwords (service, username, encrypted_password, notes, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (p["service"], p.get("username"), p["encrypted_password"],
                     p.get("notes"), p.get("created_at"), p.get("updated_at")))
            for s in bundle.get("signals", []):
                conn.execute("""
                    INSERT INTO signal_history (signal_type, ssid, bssid, rssi, frequency,
                    estimated_distance, distance_confidence, timestamp)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (s["signal_type"], s.get("ssid"), s.get("bssid"), s.get("rssi"),
                     s.get("frequency"), s.get("estimated_distance"), s.get("distance_confidence"),
                     s.get("timestamp")))
            for p in bundle.get("points", []):
                conn.execute("""
                    INSERT INTO map_points (latitude, longitude, altitude, label, signal_id, timestamp)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (p.get("latitude"), p.get("longitude"), p.get("altitude"),
                     p.get("label"), p.get("signal_id"), p.get("timestamp")))
        logger.info(f"Imported {len(bundle.get('passwords', []))} passwords, "
                   f"{len(bundle.get('signals', []))} signals, "
                   f"{len(bundle.get('points', []))} points")


# ============================================================
# ENCRYPTION (AES-256-GCM)
# ============================================================
class Encryption:
    """
    AES-256-GCM authenticated encryption.
    Key derived via PBKDF2-HMAC-SHA256 (600k iterations) or Argon2id.
    Salt and KDF metadata stored in database for migration support.
    """

    def __init__(self, master_password: str, db: Database):
        self.db = db
        self.salt = self._load_or_create_salt()
        self.key = self._derive_key(master_password, self.salt)

    def _load_or_create_salt(self) -> bytes:
        salt_b64 = self.db.get_metadata("salt")
        if salt_b64:
            import base64
            return base64.b64decode(salt_b64)
        else:
            salt = secrets.token_bytes(32)
            import base64
            self.db.set_metadata("salt", base64.b64encode(salt).decode())
            self.db.set_metadata("kdf", Config.KDF_ALGORITHM)
            self.db.set_metadata("cipher", "aes-256-gcm")
            self.db.set_metadata("version", Config.VERSION)
            logger.info("New database salt and metadata generated")
            return salt

    def _derive_key(self, password: str, salt: bytes) -> bytes:
        """
        Derive encryption key using configured KDF.
        Default: PBKDF2-HMAC-SHA256 with 600k iterations (OWASP recommendation).
        Optional: Argon2id via argon2-cffi library.
        """
        if Config.KDF_ALGORITHM == "argon2id" and ARGON2_AVAILABLE:
            logger.info("Using Argon2id KDF")
            return hash_secret_raw(
                password.encode("utf-8"),
                salt,
                time_cost=Config.ARGON2_TIME_COST,
                memory_cost=Config.ARGON2_MEMORY,
                parallelism=Config.ARGON2_PARALLELISM,
                hash_len=32,
                type=Type.ID
            )

        # Default: PBKDF2-HMAC-SHA256
        if Config.KDF_ALGORITHM == "argon2id" and not ARGON2_AVAILABLE:
            logger.warning("argon2-cffi not installed, falling back to PBKDF2")

        logger.info(f"Using PBKDF2-HMAC-SHA256 with {Config.PBKDF2_ITERATIONS} iterations")
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=Config.PBKDF2_ITERATIONS,
        )
        return kdf.derive(password.encode("utf-8"))

    def encrypt(self, data: str) -> str:
        import base64
        nonce = secrets.token_bytes(12)
        aesgcm = AESGCM(self.key)
        ciphertext = aesgcm.encrypt(nonce, data.encode("utf-8"), None)
        return base64.b64encode(nonce + ciphertext).decode()

    def decrypt(self, encrypted_data: str) -> str:
        import base64
        try:
            data = base64.b64decode(encrypted_data.encode())
            nonce, ciphertext = data[:12], data[12:]
            aesgcm = AESGCM(self.key)
            return aesgcm.decrypt(nonce, ciphertext, None).decode("utf-8")
        except Exception as e:
            logger.error(f"Decryption failed: {e}")
            raise ValueError("Decryption failed - wrong password or corrupted data")

    def clear_key(self):
        """Securely clear key from memory."""
        self.key = None
        self.salt = None

# ============================================================
# AUTHENTICATION (with Panic Code)
# ============================================================
class Authentication:
    """
    Handles master password verification with:
    - PBKDF2-HMAC-SHA256 password hashing
    - hmac.compare_digest for timing-attack resistance
    - Configurable panic code (stored as hash in DB metadata)
    - Auto-lock after inactivity
    - Self-destruct after max failed logins
    """

    def __init__(self, db: Database):
        self.db = db
        self._master_hash = None
        self._panic_hash = None
        self._last_activity = time.time()
        self._locked = False
        self._failed_attempts = 0
        self._load_hashes()

    def _load_hashes(self):
        key_file = self.db.base_dir / ".master_key"
        if key_file.exists():
            with open(key_file, "r", encoding="utf-8") as f:
                self._master_hash = f.read().strip()
        # Load panic hash from DB metadata
        self._panic_hash = self.db.get_metadata("panic_hash")

    def _hash_password(self, password: str) -> str:
        salt = secrets.token_hex(16)
        pwdhash = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100000)
        return salt + pwdhash.hex()

    def _verify_password(self, password: str, stored: str) -> bool:
        salt = stored[:32]
        stored_hash = stored[32:]
        pwdhash = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100000)
        return hmac.compare_digest(pwdhash.hex(), stored_hash)

    def is_first_run(self) -> bool:
        return self._master_hash is None

    def setup_master_password(self, password: str, panic_code: str):
        if len(password) < 8:
            raise ValueError("Password must be at least 8 characters")
        if len(panic_code) < 4:
            raise ValueError("Panic code must be at least 4 characters")

        self._master_hash = self._hash_password(password)
        key_file = self.db.base_dir / ".master_key"
        with open(key_file, "w", encoding="utf-8") as f:
            f.write(self._master_hash)
        if os.name != "nt":
            os.chmod(key_file, 0o600)

        # Store panic code hash in DB (not plaintext)
        self._panic_hash = self._hash_password(panic_code)
        self.db.set_metadata("panic_hash", self._panic_hash)

        self._log_auth("SETUP", "SUCCESS")
        logger.info("Master password and panic code set")

    def login(self, password: str) -> Tuple[bool, bool]:
        """
        Returns: (success, is_panic)
        is_panic=True triggers self-destruct.
        """
        # Check panic code first
        if self._panic_hash and self._verify_password(password, self._panic_hash):
            logger.critical("PANIC CODE ENTERED")
            return False, True

        if self._master_hash is None:
            return False, False

        if self._verify_password(password, self._master_hash):
            self._last_activity = time.time()
            self._locked = False
            self._failed_attempts = 0
            self._log_auth("LOGIN", "SUCCESS")
            return True, False

        self._failed_attempts += 1
        self._log_auth("LOGIN", "FAILED")
        logger.warning(f"Failed attempt {self._failed_attempts}/{Config.MAX_FAILED_LOGINS}")

        if self._failed_attempts >= Config.MAX_FAILED_LOGINS:
            logger.critical("MAX FAILED LOGINS - SELF-DESTRUCT")
            return False, True

        return False, False

    def check_auto_lock(self):
        if time.time() - self._last_activity > Config.LOCK_TIMEOUT:
            if not self._locked:
                self._locked = True
                logger.info("Auto-locked")
        return self._locked

    def update_activity(self):
        self._last_activity = time.time()
        self._locked = False

    def _log_auth(self, action: str, status: str):
        with self.db._connect() as conn:
            conn.execute(
                "INSERT INTO auth_log (action, status) VALUES (?, ?)",
                (action, status)
            )

# ============================================================
# SECURITY MANAGER
# ============================================================
class SecurityManager:
    """Central security coordinator managing auth, encryption, and session lifecycle."""

    def __init__(self, db: Database):
        self.db = db
        self.auth = Authentication(db)
        self.encryption = None
        self._session_active = False

    def is_first_run(self) -> bool:
        return self.auth.is_first_run()

    def setup(self, password: str, panic_code: str):
        self.auth.setup_master_password(password, panic_code)
        self._start_session(password)

    def login(self, password: str) -> Tuple[bool, bool]:
        success, is_panic = self.auth.login(password)
        if is_panic:
            self._trigger_panic()
            return False, True
        if success:
            self._start_session(password)
            return True, False
        return False, False

    def _trigger_panic(self):
        logger.critical("PANIC MODE - WIPING ALL DATA")
        if self.encryption:
            self.encryption.clear_key()
            self.encryption = None
        self.db.wipe_all_data()
        key_file = self.db.base_dir / ".master_key"
        if key_file.exists():
            key_file.unlink()
        self._session_active = False

    def _start_session(self, password: str):
        self.encryption = Encryption(password, self.db)
        self._session_active = True
        logger.info("Session started")

    def lock(self):
        if self.encryption:
            self.encryption.clear_key()
            self.encryption = None
        self._session_active = False
        self.auth._locked = True
        logger.info("Session locked")

    def unlock(self, password: str) -> Tuple[bool, bool]:
        success, is_panic = self.auth.login(password)
        if is_panic:
            self._trigger_panic()
            return False, True
        if success:
            self._start_session(password)
            return True, False
        return False, False

    def check_auto_lock(self):
        if self.auth.check_auto_lock() and self._session_active:
            self.lock()
        return self.auth._locked

    def update_activity(self):
        self.auth.update_activity()

    @property
    def is_locked(self) -> bool:
        return self.auth._locked or not self._session_active

    @property
    def is_active(self) -> bool:
        return self._session_active and not self.auth._locked


# ============================================================
# PASSWORD MANAGER
# ============================================================
class PasswordManager:
    def __init__(self, db: Database, encryption: Encryption):
        self.db = db
        self.encryption = encryption

    def add_password(self, service: str, username: str, password: str, notes: str = ""):
        encrypted = self.encryption.encrypt(password)
        with self.db._connect() as conn:
            conn.execute("""
                INSERT INTO passwords (service, username, encrypted_password, notes)
                VALUES (?, ?, ?, ?)
            """, (service, username, encrypted, notes))
        logger.info(f"Password added: {service}")

    def get_passwords(self) -> List[Dict]:
        with self.db._connect() as conn:
            rows = conn.execute("SELECT * FROM passwords ORDER BY created_at DESC").fetchall()
            return [dict(row) for row in rows]

    def get_password(self, entry_id: int) -> Optional[str]:
        with self.db._connect() as conn:
            row = conn.execute(
                "SELECT encrypted_password FROM passwords WHERE id = ?", (entry_id,)
            ).fetchone()
            if row:
                return self.encryption.decrypt(row["encrypted_password"])
        return None

    def delete_password(self, entry_id: int):
        with self.db._connect() as conn:
            conn.execute("DELETE FROM passwords WHERE id = ?", (entry_id,))
        logger.info(f"Deleted entry {entry_id}")

    def update_password(self, entry_id: int, service: str = None, username: str = None,
                       password: str = None, notes: str = None):
        updates, params = [], []
        if service is not None:
            updates.append("service = ?")
            params.append(service)
        if username is not None:
            updates.append("username = ?")
            params.append(username)
        if password is not None:
            updates.append("encrypted_password = ?")
            params.append(self.encryption.encrypt(password))
        if notes is not None:
            updates.append("notes = ?")
            params.append(notes)
        if updates:
            params.append(entry_id)
            with self.db._connect() as conn:
                conn.execute(
                    f"UPDATE passwords SET {', '.join(updates)}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    params
                )
            logger.info(f"Updated entry {entry_id}")

# ============================================================
# PASSWORD GENERATOR
# ============================================================
class PasswordGenerator:
    @staticmethod
    def generate(length: int = 16, uppercase: bool = True, lowercase: bool = True,
                 digits: bool = True, symbols: bool = True) -> Tuple[str, str]:
        if length < 4:
            raise ValueError("Length must be at least 4")
        categories = []
        if lowercase: categories.append(string.ascii_lowercase)
        if uppercase: categories.append(string.ascii_uppercase)
        if digits: categories.append(string.digits)
        if symbols: categories.append("!@#$%^&*()_+-=[]{}|;:,.<>?")
        if not categories:
            raise ValueError("Select at least one character type")
        if length < len(categories):
            raise ValueError(f"Length must be at least {len(categories)}")

        password_chars = [secrets.choice(cat) for cat in categories]
        all_chars = "".join(categories)
        for _ in range(length - len(categories)):
            password_chars.append(secrets.choice(all_chars))

        shuffled = list(password_chars)
        for i in range(len(shuffled) - 1, 0, -1):
            j = secrets.randbelow(i + 1)
            shuffled[i], shuffled[j] = shuffled[j], shuffled[i]

        password = "".join(shuffled)
        strength = PasswordGenerator._check_strength(password)
        return password, strength

    @staticmethod
    def _check_strength(password: str) -> str:
        score = 0
        if len(password) >= 12: score += 1
        if len(password) >= 16: score += 1
        if any(c.isupper() for c in password): score += 1
        if any(c.islower() for c in password): score += 1
        if any(c.isdigit() for c in password): score += 1
        if any(c in string.punctuation for c in password): score += 1
        if score <= 2: return "Weak"
        elif score <= 4: return "Medium"
        elif score <= 5: return "Strong"
        else: return "Very Strong"

# ============================================================
# SIGNAL SCANNER
# ============================================================
@dataclass
class SignalReading:
    signal_type: str
    ssid: Optional[str]
    bssid: str
    rssi: int
    frequency: Optional[float]
    estimated_distance: Optional[float]
    distance_confidence: str
    timestamp: str

class SignalScanner:
    """
    Scan WiFi and Bluetooth signals.
    Distance is estimated via Free Space Path Loss - APPROXIMATE ONLY.
    """

    def __init__(self, db: Database):
        self.db = db
        self.scanning = False
        self._scan_thread = None
        self._last_results = []

    def _estimate_distance(self, rssi: int, freq_mhz: float = 2400) -> Tuple[float, str]:
        """Estimate distance using FSPL. Returns (meters, confidence)."""
        try:
            distance = 10 ** ((27.55 - 20 * math.log10(freq_mhz) + abs(rssi)) / 20)
            distance = round(min(distance, 100), 2)
            if rssi > -50: confidence = "HIGH"
            elif rssi > -70: confidence = "MEDIUM"
            else: confidence = "LOW"
            return distance, confidence
        except:
            return -1.0, "UNKNOWN"

    def scan_wifi(self) -> List[SignalReading]:
        results = []
        try:
            cmd = ["nmcli", "-t", "-f", "SSID,BSSID,SIGNAL,FREQ",
                   "--separator", "|", "dev", "wifi"]
            output = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if output.returncode == 0 and output.stdout:
                for line in output.stdout.strip().split(chr(10)):
                    parts = line.split("|")
                    if len(parts) >= 4:
                        ssid = parts[0] if parts[0] else "Hidden"
                        bssid = parts[1]
                        signal = int(parts[2]) if parts[2].isdigit() else -100
                        freq = float(parts[3]) if parts[3] else 2400
                        rssi_estimated = (signal / 2) - 100
                        distance, confidence = self._estimate_distance(int(rssi_estimated), freq)
                        results.append(SignalReading(
                            signal_type="WiFi", ssid=ssid[:20], bssid=bssid,
                            rssi=int(rssi_estimated), frequency=freq,
                            estimated_distance=distance, distance_confidence=confidence,
                            timestamp=datetime.now().isoformat()
                        ))
        except FileNotFoundError:
            logger.debug("nmcli not found")
        except Exception as e:
            logger.error(f"nmcli error: {e}")

        if not results:
            try:
                cmd = ["sudo", "iwlist", "scan"]
                output = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
                if output.returncode == 0:
                    results = self._parse_iwlist(output.stdout)
            except FileNotFoundError:
                logger.warning("iwlist not found")
            except Exception as e:
                logger.error(f"iwlist error: {e}")
        return results

    def _parse_iwlist(self, output: str) -> List[SignalReading]:
        results = []
        cells = output.split("Cell ")
        for cell in cells[1:]:
            try:
                essid_match = re.search(r'ESSID:"([^"]*)"', cell)
                address_match = re.search(r'Address: ([0-9A-F:]{17})', cell)
                signal_match = re.search(r'Signal level=(-?\d+)', cell)
                freq_match = re.search(r'Frequency:([\d.]+)', cell)
                if address_match:
                    ssid = essid_match.group(1) if essid_match else "Hidden"
                    bssid = address_match.group(1)
                    rssi = int(signal_match.group(1)) if signal_match else -100
                    freq = float(freq_match.group(1)) * 1000 if freq_match else 2400
                    distance, confidence = self._estimate_distance(rssi, freq)
                    results.append(SignalReading(
                        signal_type="WiFi", ssid=ssid[:20], bssid=bssid,
                        rssi=rssi, frequency=freq,
                        estimated_distance=distance, distance_confidence=confidence,
                        timestamp=datetime.now().isoformat()
                    ))
            except Exception:
                continue
        return results

    def scan_bluetooth(self) -> List[SignalReading]:
        results = []
        btctl_results = self._scan_bluetoothctl()
        if btctl_results:
            return btctl_results
        try:
            cmd = ["hcitool", "scan", "--flush"]
            output = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if output.returncode == 0:
                for line in output.stdout.strip().split(chr(10))[1:]:
                    parts = line.strip().split(chr(9))
                    if len(parts) >= 2:
                        mac = parts[0]
                        name = parts[1] if len(parts) > 1 else "Unknown"
                        rssi = -100
                        try:
                            rssi_cmd = ["hcitool", "rssi", mac]
                            rssi_out = subprocess.run(rssi_cmd, capture_output=True, text=True, timeout=5)
                            if rssi_out.returncode == 0:
                                rssi_match = re.search(r'-?\d+', rssi_out.stdout)
                                if rssi_match:
                                    rssi = int(rssi_match.group())
                        except:
                            pass
                        distance, confidence = self._estimate_distance(rssi, 2400)
                        results.append(SignalReading(
                            signal_type="Bluetooth", ssid=name[:20], bssid=mac,
                            rssi=rssi, frequency=2400,
                            estimated_distance=distance, distance_confidence=confidence,
                            timestamp=datetime.now().isoformat()
                        ))
        except FileNotFoundError:
            logger.warning("hcitool not found")
        except Exception as e:
            logger.error(f"Bluetooth scan error: {e}")
        return results

    def _scan_bluetoothctl(self) -> List[SignalReading]:
        results = []
        try:
            subprocess.run(["bluetoothctl", "scan", "on"],
                          capture_output=True, text=True, timeout=2)
            time.sleep(5)
            output = subprocess.run(["bluetoothctl", "devices"],
                                   capture_output=True, text=True, timeout=5)
            if output.returncode == 0:
                for line in output.stdout.strip().split(chr(10)):
                    match = re.match(r'Device\s+([0-9A-F:]{17})\s+(.+)', line)
                    if match:
                        mac = match.group(1)
                        name = match.group(2)
                        rssi = -100
                        try:
                            info = subprocess.run(["bluetoothctl", "info", mac],
                                                capture_output=True, text=True, timeout=3)
                            rssi_match = re.search(r'RSSI:\s*(-?\d+)', info.stdout)
                            if rssi_match:
                                rssi = int(rssi_match.group(1))
                        except:
                            pass
                        distance, confidence = self._estimate_distance(rssi, 2400)
                        results.append(SignalReading(
                            signal_type="Bluetooth", ssid=name[:20], bssid=mac,
                            rssi=rssi, frequency=2400,
                            estimated_distance=distance, distance_confidence=confidence,
                            timestamp=datetime.now().isoformat()
                        ))
            subprocess.run(["bluetoothctl", "scan", "off"],
                          capture_output=True, text=True, timeout=2)
        except FileNotFoundError:
            logger.debug("bluetoothctl not found")
        except Exception as e:
            logger.error(f"bluetoothctl error: {e}")
        return results

    def scan_all(self) -> List[SignalReading]:
        wifi = self.scan_wifi()
        bt = self.scan_bluetooth()
        all_signals = wifi + bt
        all_signals.sort(key=lambda x: x.rssi, reverse=True)
        self._last_results = all_signals
        self._save_to_db(all_signals)
        self.db.cleanup_old_signals()
        return all_signals

    def _save_to_db(self, signals: List[SignalReading]):
        with self.db._connect() as conn:
            for sig in signals:
                conn.execute("""
                    INSERT INTO signal_history
                    (signal_type, ssid, bssid, rssi, frequency, estimated_distance, distance_confidence)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (sig.signal_type, sig.ssid, sig.bssid, sig.rssi,
                     sig.frequency, sig.estimated_distance, sig.distance_confidence))

    def get_history(self, limit: int = 50) -> List[Dict]:
        with self.db._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM signal_history ORDER BY timestamp DESC LIMIT ?", (limit,)
            ).fetchall()
            return [dict(row) for row in rows]

    def start_continuous_scan(self, callback=None):
        self.scanning = True
        def scan_loop():
            while self.scanning:
                results = self.scan_all()
                if callback:
                    callback(results)
                time.sleep(Config.SIGNAL_SCAN_INTERVAL)
        self._scan_thread = threading.Thread(target=scan_loop, daemon=True)
        self._scan_thread.start()

    def stop_continuous_scan(self):
        self.scanning = False


# ============================================================
# MAP MANAGER
# ============================================================
class MapManager:
    def __init__(self, db: Database):
        self.db = db

    def get_gps_location(self) -> Optional[Tuple[float, float, float]]:
        loc = self._get_gpsd_location()
        if loc: return loc
        loc = self._get_geoclue_location()
        if loc: return loc
        loc = self._get_termux_location()
        if loc: return loc
        return None

    def _get_gpsd_location(self) -> Optional[Tuple[float, float, float]]:
        try:
            import socket
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(3)
            sock.connect(("localhost", 2947))
            sock.sendall(b'?WATCH={\"enable\":true}\n')
            time.sleep(1)
            sock.sendall(b'?POLL;\n')
            data = b''
            start_time = time.time()
            while time.time() - start_time < 3:
                chunk = sock.recv(4096)
                if not chunk: break
                data += chunk
                if b'"lat"' in data and b'"lon"' in data: break
            sock.close()
            data_str = data.decode()
            lat_match = re.search(r'"lat":([-?\d.]+)', data_str)
            lon_match = re.search(r'"lon":([-?\d.]+)', data_str)
            alt_match = re.search(r'"alt":([-?\d.]+)', data_str)
            if lat_match and lon_match:
                return (float(lat_match.group(1)), float(lon_match.group(1)),
                        float(alt_match.group(1)) if alt_match else 0.0)
        except Exception as e:
            logger.debug(f"gpsd error: {e}")
        return None

    def _get_geoclue_location(self) -> Optional[Tuple[float, float, float]]:
        try:
            client_cmd = ["busctl", "--user", "call", "org.freedesktop.GeoClue2",
                         "/org/freedesktop/GeoClue2/Manager", "org.freedesktop.GeoClue2.Manager", "GetClient"]
            client_out = subprocess.run(client_cmd, capture_output=True, text=True, timeout=5)
            if client_out.returncode == 0:
                path_match = re.search(r'"(/org/freedesktop/GeoClue2/Client/\d+)"', client_out.stdout)
                if path_match:
                    client_path = path_match.group(1)
                    subprocess.run(["busctl", "--user", "set-property", "org.freedesktop.GeoClue2",
                                   client_path, "org.freedesktop.GeoClue2.Client", "DesktopId",
                                   "s", "sovereignx"], capture_output=True, timeout=3)
                    subprocess.run(["busctl", "--user", "call", "org.freedesktop.GeoClue2",
                                   client_path, "org.freedesktop.GeoClue2.Client", "Start"],
                                  capture_output=True, timeout=3)
                    time.sleep(2)
                    loc_cmd = ["busctl", "--user", "get-property", "org.freedesktop.GeoClue2",
                              client_path, "org.freedesktop.GeoClue2.Client", "Location"]
                    loc_out = subprocess.run(loc_cmd, capture_output=True, text=True, timeout=3)
                    if loc_out.returncode == 0:
                        path_match = re.search(r'"(/org/freedesktop/GeoClue2/Location/\d+)"', loc_out.stdout)
                        if path_match:
                            loc_path = path_match.group(1)
                            props = ["Latitude", "Longitude", "Altitude"]
                            vals = []
                            for prop in props:
                                pcmd = ["busctl", "--user", "get-property", "org.freedesktop.GeoClue2",
                                       loc_path, "org.freedesktop.GeoClue2.Location", prop]
                                pout = subprocess.run(pcmd, capture_output=True, text=True, timeout=3)
                                val_match = re.search(r'd\s+(-?[\d.]+)', pout.stdout)
                                vals.append(float(val_match.group(1)) if val_match else 0.0)
                            return tuple(vals)
        except Exception as e:
            logger.debug(f"geoclue error: {e}")
        return None

    def _get_termux_location(self) -> Optional[Tuple[float, float, float]]:
        try:
            output = subprocess.run(["termux-location"], capture_output=True, text=True, timeout=10)
            if output.returncode == 0:
                data = json.loads(output.stdout)
                return (data.get("latitude", 0.0), data.get("longitude", 0.0), data.get("altitude", 0.0))
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        except Exception as e:
            logger.debug(f"termux-location error: {e}")
        return None

    def add_point(self, lat: float, lon: float, altitude: float = 0.0, label: str = "", signal_id: int = None):
        with self.db._connect() as conn:
            conn.execute("""
                INSERT INTO map_points (latitude, longitude, altitude, label, signal_id)
                VALUES (?, ?, ?, ?, ?)
            """, (lat, lon, altitude, label, signal_id))
        logger.info(f"Map point added: {lat}, {lon}")

    def get_points(self, limit: int = 100) -> List[Dict]:
        with self.db._connect() as conn:
            rows = conn.execute("SELECT * FROM map_points ORDER BY timestamp DESC LIMIT ?", (limit,)).fetchall()
            return [dict(row) for row in rows]

    def generate_ascii_map(self, points: List[Dict], width: int = 40, height: int = 15) -> str:
        if not points:
            return "No points on map"
        lats = [p["latitude"] for p in points]
        lons = [p["longitude"] for p in points]
        min_lat, max_lat = min(lats), max(lats)
        min_lon, max_lon = min(lons), max(lons)
        lat_pad = (max_lat - min_lat) * 0.1 or 0.001
        lon_pad = (max_lon - min_lon) * 0.1 or 0.001
        min_lat -= lat_pad; max_lat += lat_pad
        min_lon -= lon_pad; max_lon += lon_pad
        grid = [["." for _ in range(width)] for _ in range(height)]
        for p in points:
            x = int((p["longitude"] - min_lon) / (max_lon - min_lon) * (width - 1))
            y = int((max_lat - p["latitude"]) / (max_lat - min_lat) * (height - 1))
            x = max(0, min(x, width - 1))
            y = max(0, min(y, height - 1))
            grid[y][x] = "X"
        lines = [
            "+" + "-" * width + "+",
            f"|{"Map Points":^{width}}|",
            "+" + "-" * width + "+"
        ]
        for row in grid:
            lines.append("|" + "".join(row) + "|")
        lines.append("+" + "-" * width + "+")
        lines.append(f"Range: [{min_lat:.4f}, {min_lon:.4f}] -> [{max_lat:.4f}, {max_lon:.4f}]")
        return chr(10).join(lines)


# ============================================================
# TERMINAL UI
# ============================================================
class TerminalUI:
    def __init__(self, security: SecurityManager, db: Database):
        self.security = security
        self.db = db
        self.password_manager = None
        self.scanner = SignalScanner(db)
        self.map_manager = MapManager(db)
        self.running = True

    def clear(self):
        os.system("clear" if os.name != "nt" else "cls")

    def print_header(self, title: str):
        w = Config.SCREEN_WIDTH
        self.clear()
        print("=" * w)
        print(f"{title:^{w}}")
        print("=" * w)

    def print_box(self, text: str):
        w = Config.SCREEN_WIDTH
        print("+" + "-" * (w - 2) + "+")
        for line in text.split(chr(10)):
            print(f"| {line:<{w-4}} |")
        print("+" + "-" * (w - 2) + "+")

    def input_prompt(self, prompt: str) -> str:
        self.security.update_activity()
        value = input(f">>> {prompt}: ").strip()
        self.security.update_activity()
        return value

    def secure_input(self, prompt: str) -> str:
        self.security.update_activity()
        value = getpass.getpass(f">>> {prompt}: ")
        self.security.update_activity()
        return value

    def show_menu(self, title: str, options: Dict[str, str]) -> str:
        self.print_header(title)
        for key, value in options.items():
            print(f"  [{key}] {value}")
        print("-" * Config.SCREEN_WIDTH)
        return self.input_prompt("Select")

    def run(self):
        if self.security.is_first_run():
            self.setup_wizard()
        if not self.login_screen():
            return
        while self.running:
            if self.security.check_auto_lock():
                self.locked_screen()
                continue
            choice = self.show_menu("SovereignX Security Hub", {
                "1": "Password Vault",
                "2": "Password Generator",
                "3": "Signal Scanner",
                "4": "Signal Analyzer",
                "5": "GPS / Map",
                "6": "Activity Log",
                "7": "Export / Import",
                "8": "Lock Device",
                "0": "Exit"
            })
            if choice == "1": self.password_manager_menu()
            elif choice == "2": self.password_generator_menu()
            elif choice == "3": self.signal_scanner_menu()
            elif choice == "4": self.signal_analyzer_menu()
            elif choice == "5": self.map_menu()
            elif choice == "6": self.activity_log_menu()
            elif choice == "7": self.export_import_menu()
            elif choice == "8": self.security.lock()
            elif choice == "0": self.running = False

    def setup_wizard(self):
        self.print_header("Initial Setup")
        print("Welcome to SovereignX Security Hub")
        print("Create master password and panic code")
        print("-" * Config.SCREEN_WIDTH)
        while True:
            pwd = self.secure_input("Master password (min 8 chars)")
            confirm = self.secure_input("Confirm password")
            if pwd != confirm or len(pwd) < 8:
                print("Error: Passwords do not match or too short")
                continue
            panic = self.secure_input("Panic code (min 4 chars, used to wipe data)")
            if len(panic) < 4:
                print("Error: Panic code too short")
                continue
            try:
                self.security.setup(pwd, panic)
                self.password_manager = PasswordManager(self.db, self.security.encryption)
                print("Setup complete!")
                time.sleep(1)
                break
            except Exception as e:
                print(f"Error: {e}")

    def login_screen(self) -> bool:
        attempts = 0
        while attempts < 3:
            self.print_header("Login")
            pwd = self.secure_input("Master password")
            success, panic = self.security.login(pwd)
            if panic:
                self.print_header("PANIC MODE ACTIVATED")
                print("All data has been wiped!")
                print("Restart required...")
                time.sleep(3)
                sys.exit(0)
            if success:
                self.password_manager = PasswordManager(self.db, self.security.encryption)
                print("Login successful")
                time.sleep(1)
                return True
            else:
                attempts += 1
                print(f"Wrong password (attempt {attempts}/3)")
                time.sleep(1)
        print("Max attempts exceeded. Exiting...")
        time.sleep(2)
        return False

    def locked_screen(self):
        self.print_header("Device Locked")
        print("Auto-locked due to inactivity")
        print("-" * Config.SCREEN_WIDTH)
        pwd = self.secure_input("Enter password to unlock")
        success, panic = self.security.unlock(pwd)
        if panic:
            self.print_header("PANIC MODE ACTIVATED")
            print("All data has been wiped!")
            time.sleep(3)
            sys.exit(0)
        if success:
            self.password_manager = PasswordManager(self.db, self.security.encryption)
            print("Unlocked")
            time.sleep(1)
        else:
            print("Wrong password")
            time.sleep(1)

    def password_manager_menu(self):
        while True:
            choice = self.show_menu("Password Vault", {
                "1": "View saved passwords",
                "2": "Add new password",
                "3": "Delete password",
                "4": "Show password (decrypt)",
                "0": "Back"
            })
            if choice == "1":
                passwords = self.password_manager.get_passwords()
                self.print_header("Saved Passwords")
                if not passwords:
                    print("No passwords saved")
                else:
                    for p in passwords:
                        print(f"ID:{p['id']} | {p['service']} | {p['username']} | {p['created_at']}")
                input("Press Enter to continue...")
            elif choice == "2":
                service = self.input_prompt("Service name")
                username = self.input_prompt("Username")
                password = self.secure_input("Password")
                notes = self.input_prompt("Notes (optional)")
                self.password_manager.add_password(service, username, password, notes)
                print("Saved successfully")
                time.sleep(1)
            elif choice == "3":
                pid = self.input_prompt("Enter ID to delete")
                if pid.isdigit():
                    self.password_manager.delete_password(int(pid))
                    print("Deleted")
                time.sleep(1)
            elif choice == "4":
                pid = self.input_prompt("Enter ID to show password")
                if pid.isdigit():
                    pwd = self.password_manager.get_password(int(pid))
                    if pwd:
                        self.print_box(f"Password: {pwd}")
                    else:
                        print("Not found")
                input("Press Enter to continue...")
            elif choice == "0":
                break

    def password_generator_menu(self):
        self.print_header("Password Generator")
        try:
            length = int(self.input_prompt("Password length (default 16)") or "16")
            upper = self.input_prompt("Include uppercase? (y/n)").lower() != "n"
            lower = self.input_prompt("Include lowercase? (y/n)").lower() != "n"
            digits = self.input_prompt("Include digits? (y/n)").lower() != "n"
            symbols = self.input_prompt("Include symbols? (y/n)").lower() != "n"
            password, strength = PasswordGenerator.generate(length, upper, lower, digits, symbols)
            self.print_box(f"Password: {password}\nStrength: {strength}")
            save = self.input_prompt("Save to vault? (y/n)").lower()
            if save == "y":
                service = self.input_prompt("Service name")
                username = self.input_prompt("Username")
                self.password_manager.add_password(service, username, password)
                print("Saved")
        except Exception as e:
            print(f"Error: {e}")
        input("Press Enter to continue...")

    def signal_scanner_menu(self):
        while True:
            choice = self.show_menu("Signal Scanner", {
                "1": "Scan WiFi",
                "2": "Scan Bluetooth",
                "3": "Full Scan",
                "4": "Continuous Scan",
                "5": "Stop Continuous",
                "0": "Back"
            })
            if choice == "1":
                self.print_header("Scanning WiFi...")
                results = self.scanner.scan_wifi()
                self._display_signals(results)
            elif choice == "2":
                self.print_header("Scanning Bluetooth...")
                results = self.scanner.scan_bluetooth()
                self._display_signals(results)
            elif choice == "3":
                self.print_header("Full Scan...")
                results = self.scanner.scan_all()
                self._display_signals(results)
            elif choice == "4":
                print("Starting continuous scan... (Press Enter to stop)")
                self.scanner.start_continuous_scan(self._display_signals_callback)
                input()
                self.scanner.stop_continuous_scan()
            elif choice == "5":
                self.scanner.stop_continuous_scan()
                print("Scan stopped")
                time.sleep(1)
            elif choice == "0":
                break

    def _display_signals(self, results: List[SignalReading]):
        self.print_header(f"Scan Results - {len(results)} signals")
        if not results:
            print("No signals found")
        else:
            print(f"{'Type':<8} {'Name':<15} {'RSSI':<6} {'Distance':<10}")
            print("-" * Config.SCREEN_WIDTH)
            for r in results[:20]:
                dist = f"{r.estimated_distance}m" if r.estimated_distance and r.estimated_distance > 0 else "N/A"
                name = (r.ssid or "Hidden")[:14]
                print(f"{r.signal_type:<8} {name:<15} {r.rssi:<6} {dist:<10}")
        print("\n[!] Distance is approximate - affected by walls and interference")
        input("Press Enter to continue...")

    def _display_signals_callback(self, results: List[SignalReading]):
        self.clear()
        print(f"[Continuous] {len(results)} signals detected")
        for r in results[:10]:
            dist = f"{r.estimated_distance}m" if r.estimated_distance and r.estimated_distance > 0 else "N/A"
            conf = r.distance_confidence
            print(f"{r.signal_type}: {r.ssid or 'Hidden'} | RSSI:{r.rssi} | {dist} ({conf})")
        print("\n(Press Enter in menu to stop)")

    def signal_analyzer_menu(self):
        self.print_header("Signal Analyzer")
        history = self.scanner.get_history(50)
        if not history:
            print("No data available")
        else:
            wifi_count = sum(1 for h in history if h["signal_type"] == "WiFi")
            bt_count = sum(1 for h in history if h["signal_type"] == "Bluetooth")
            avg_rssi = sum(h["rssi"] for h in history) / len(history)
            self.print_box(f"Total readings: {len(history)}\nWiFi: {wifi_count} | BT: {bt_count}\nAvg RSSI: {avg_rssi:.1f} dBm")
            print("\nLast 10 readings:")
            for h in history[:10]:
                dist = f"{h['estimated_distance']}m" if h["estimated_distance"] else "N/A"
                conf = h.get("distance_confidence", "N/A")
                print(f"{h['timestamp'][:16]} | {h['signal_type']} | {h['ssid'] or 'Hidden'} | {dist} ({conf})")
        input("Press Enter to continue...")

    def map_menu(self):
        while True:
            choice = self.show_menu("GPS / Map", {
                "1": "Read current GPS location",
                "2": "View saved points",
                "3": "Add point manually",
                "4": "Show ASCII map",
                "0": "Back"
            })
            if choice == "1":
                self.print_header("Reading GPS...")
                loc = self.map_manager.get_gps_location()
                if loc:
                    lat, lon, alt = loc
                    self.print_box(f"Current location:\nLat: {lat:.6f}\nLon: {lon:.6f}\nAlt: {alt:.1f}m")
                    save = self.input_prompt("Save point? (y/n)").lower()
                    if save == "y":
                        label = self.input_prompt("Point name")
                        self.map_manager.add_point(lat, lon, alt, label)
                        print("Saved")
                else:
                    print("Cannot get GPS location")
                    print("Ensure gpsd or location service is running")
                time.sleep(2)
            elif choice == "2":
                points = self.map_manager.get_points()
                self.print_header("Saved Points")
                if not points:
                    print("No points")
                else:
                    for p in points:
                        print(f"ID:{p['id']} | {p['label'] or 'Unnamed'} | {p['latitude']:.4f}, {p['longitude']:.4f}")
                input("Press Enter to continue...")
            elif choice == "3":
                try:
                    lat = float(self.input_prompt("Latitude"))
                    lon = float(self.input_prompt("Longitude"))
                    alt = float(self.input_prompt("Altitude (default 0)") or "0")
                    label = self.input_prompt("Point name")
                    self.map_manager.add_point(lat, lon, alt, label)
                    print("Added")
                except ValueError:
                    print("Invalid coordinates")
                time.sleep(1)
            elif choice == "4":
                points = self.map_manager.get_points()
                self.print_header("ASCII Map")
                print(self.map_manager.generate_ascii_map(points))
                input("Press Enter to continue...")
            elif choice == "0":
                break

    def export_import_menu(self):
        while True:
            choice = self.show_menu("Export / Import", {
                "1": "Export encrypted backup",
                "2": "Import encrypted backup",
                "0": "Back"
            })
            if choice == "1":
                self.print_header("Export Backup")
                try:
                    bundle = self.db.export_encrypted(self.security.encryption)
                    filename = self.input_prompt("Filename (no extension)") or "sovereignx_backup"
                    filepath = self.db.base_dir / f"{filename}.json"
                    with open(filepath, "w", encoding="utf-8") as f:
                        json.dump(bundle, f, ensure_ascii=False)
                    print(f"Exported to: {filepath}")
                except Exception as e:
                    print(f"Error: {e}")
                time.sleep(1)
            elif choice == "2":
                self.print_header("Import Backup")
                try:
                    filename = self.input_prompt("Filename (no extension)") or "sovereignx_backup"
                    filepath = self.db.base_dir / f"{filename}.json"
                    if not filepath.exists():
                        print("File not found")
                        time.sleep(1)
                        continue
                    confirm = self.input_prompt("This will REPLACE current data! Continue? (yes/no)").lower()
                    if confirm != "yes":
                        print("Cancelled")
                        time.sleep(1)
                        continue
                    with open(filepath, "r", encoding="utf-8") as f:
                        bundle = json.load(f)
                    self.db.wipe_all_data()
                    self.db.import_encrypted(bundle, self.security.encryption)
                    print("Import successful")
                except Exception as e:
                    print(f"Error: {e}")
                time.sleep(1)
            elif choice == "0":
                break

    def activity_log_menu(self):
        self.print_header("Activity Log")
        with self.db._connect() as conn:
            logs = conn.execute("SELECT * FROM auth_log ORDER BY timestamp DESC LIMIT 20").fetchall()
            if not logs:
                print("No logs")
            else:
                for log in logs:
                    status_icon = "OK" if log["status"] == "SUCCESS" else "FAIL"
                    print(f"{status_icon} {log['timestamp'][:16]} | {log['action']}")
        input("Press Enter to continue...")


# ============================================================
# TESTS (Fully Isolated via tempfile)
# ============================================================
def run_tests():
    print("\n" + "=" * 50)
    print("RUNNING ISOLATED TESTS")
    print("=" * 50 + "\n")
    passed = 0
    failed = 0

    with tempfile.TemporaryDirectory(prefix="sovereignx_test_") as tmpdir:
        test_base = Path(tmpdir)
        print(f"Test directory: {test_base}\n")

        # Test 1: Encryption roundtrip
        try:
            db = Database(base_dir=test_base)
            enc = Encryption("TestPassword123!", db)
            original = "Hello SovereignX"
            encrypted = enc.encrypt(original)
            decrypted = enc.decrypt(encrypted)
            assert decrypted == original
            assert encrypted != original
            print("[PASS] test_encryption_roundtrip")
            passed += 1
        except Exception as e:
            print(f"[FAIL] test_encryption_roundtrip: {e}")
            failed += 1

        # Test 2: Wrong password fails
        try:
            db = Database(base_dir=test_base)
            enc1 = Encryption("CorrectPassword123!", db)
            encrypted = enc1.encrypt("Secret Data")
            enc2 = Encryption("WrongPassword456!", db)
            try:
                enc2.decrypt(encrypted)
                print("[FAIL] test_wrong_password_fails: Should have raised error")
                failed += 1
            except ValueError:
                print("[PASS] test_wrong_password_fails")
                passed += 1
        except Exception as e:
            print(f"[FAIL] test_wrong_password_fails: {e}")
            failed += 1

        # Test 3: Password generator guarantees categories
        try:
            pwd, strength = PasswordGenerator.generate(16, uppercase=True, lowercase=True,
                                                        digits=True, symbols=True)
            assert len(pwd) == 16
            assert any(c.isupper() for c in pwd)
            assert any(c.islower() for c in pwd)
            assert any(c.isdigit() for c in pwd)
            assert any(c in string.punctuation for c in pwd)
            print("[PASS] test_password_generator_categories")
            passed += 1
        except Exception as e:
            print(f"[FAIL] test_password_generator_categories: {e}")
            failed += 1

        # Test 4: Authentication with panic code
        try:
            db = Database(base_dir=test_base)
            auth = Authentication(db)
            auth.setup_master_password("TestPass123!", "PANIC123")
            success, panic = auth.login("TestPass123!")
            assert success == True and panic == False
            success, panic = auth.login("WrongPass!")
            assert success == False and panic == False
            success, panic = auth.login("PANIC123")
            assert success == False and panic == True
            print("[PASS] test_authentication")
            passed += 1
        except Exception as e:
            print(f"[FAIL] test_authentication: {e}")
            failed += 1

        # Test 5: Database metadata
        try:
            db = Database(base_dir=test_base)
            db.set_metadata("test_key", "test_value")
            val = db.get_metadata("test_key")
            assert val == "test_value"
            print("[PASS] test_database_metadata")
            passed += 1
        except Exception as e:
            print(f"[FAIL] test_database_metadata: {e}")
            failed += 1

        # Test 6: Session lock clears encryption
        try:
            db = Database(base_dir=test_base)
            sec = SecurityManager(db)
            sec.setup("SessionTest123!", "Panic1234")
            assert sec.is_active == True
            sec.lock()
            assert sec.is_locked == True
            assert sec.encryption is None
            print("[PASS] test_session_lock")
            passed += 1
        except Exception as e:
            print(f"[FAIL] test_session_lock: {e}")
            failed += 1

        # Test 7: Panic mode wipes data
        try:
            db = Database(base_dir=test_base)
            sec = SecurityManager(db)
            sec.setup("PanicTest123!", "DESTROY")
            sec.login("DESTROY")
            assert sec.is_locked == True
            assert sec.encryption is None
            with db._connect() as conn:
                count = conn.execute("SELECT COUNT(*) FROM passwords").fetchone()[0]
                assert count == 0
            print("[PASS] test_panic_mode")
            passed += 1
        except Exception as e:
            print(f"[FAIL] test_panic_mode: {e}")
            failed += 1

        # Test 8: Export/Import roundtrip (no ID conflicts)
        try:
            db = Database(base_dir=test_base)
            sec = SecurityManager(db)
            sec.setup("ExportTest123!", "Panic9999")
            pm = PasswordManager(db, sec.encryption)
            pm.add_password("test_service", "test_user", "test_pass")
            bundle = db.export_encrypted(sec.encryption)

            test_base2 = test_base / "import_test"
            db2 = Database(base_dir=test_base2)
            sec2 = SecurityManager(db2)
            sec2.setup("ExportTest123!", "Panic9999")
            db2.import_encrypted(bundle, sec2.encryption)

            pm2 = PasswordManager(db2, sec2.encryption)
            passwords = pm2.get_passwords()
            assert len(passwords) == 1
            assert passwords[0]["service"] == "test_service"
            print("[PASS] test_export_import")
            passed += 1
        except Exception as e:
            print(f"[FAIL] test_export_import: {e}")
            failed += 1

        # Test 9: Self-destruct after max failed logins
        try:
            db = Database(base_dir=test_base)
            sec = SecurityManager(db)
            sec.setup("SelfDestruct123!", "Panic0000")
            for i in range(Config.MAX_FAILED_LOGINS):
                success, panic = sec.login("WrongPassword")
                if i < Config.MAX_FAILED_LOGINS - 1:
                    assert panic == False
                else:
                    assert panic == True
            assert sec.is_locked == True
            print("[PASS] test_self_destruct")
            passed += 1
        except Exception as e:
            print(f"[FAIL] test_self_destruct: {e}")
            failed += 1

        # Test 10: Distance estimation
        try:
            db = Database(base_dir=test_base)
            scanner = SignalScanner(db)
            dist, conf = scanner._estimate_distance(-60, 2400)
            assert dist > 0
            assert conf in ["HIGH", "MEDIUM", "LOW", "UNKNOWN"]
            print("[PASS] test_distance_estimation")
            passed += 1
        except Exception as e:
            print(f"[FAIL] test_distance_estimation: {e}")
            failed += 1

    print("\n" + "=" * 50)
    print(f"RESULTS: {passed} passed, {failed} failed")
    print("=" * 50 + "\n")
    return failed == 0

# ============================================================
# MAIN
# ============================================================
def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--test":
        success = run_tests()
        sys.exit(0 if success else 1)

    print("""
    +======================================+
    |     SovereignX Security Hub v5.0     |
    |   Portable Data & Security Tool      |
    +======================================+
    """)
    time.sleep(1)

    try:
        db = Database()
        security = SecurityManager(db)
        ui = TerminalUI(security, db)
        ui.run()
    except KeyboardInterrupt:
        print("\n\nStopped by user")
    except Exception as e:
        logger.exception("Fatal error")
        print(f"\nFatal error: {e}")
    finally:
        print("\nThank you for using SovereignX Security Hub")

if __name__ == "__main__":
    main()
