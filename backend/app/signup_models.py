"""Pre-tenant signup data; access is restricted to a private resume capability."""
from sqlalchemy import Column, String, Text, DateTime, Integer
from sqlalchemy.orm import declarative_base

SignupBase = declarative_base()

class RestaurantSignup(SignupBase):
    __tablename__ = "restaurant_signups"
    id = Column(String(36), primary_key=True)
    token_hash = Column(String(64), unique=True, nullable=False)
    payload_encrypted = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)

class SignupNotification(SignupBase):
    __tablename__ = "signup_notifications"
    id = Column(String(100), primary_key=True)
    payload_encrypted = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="pending")
    attempts = Column(Integer, nullable=False, default=0)
    next_attempt_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    claim_token = Column(String(36), nullable=True)
    last_error = Column(String(100), nullable=True)
