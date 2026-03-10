from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from .database import Base


class MLAccount(Base):
    __tablename__ = "ml_accounts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    meli_user_id = Column(BigInteger, nullable=False)
    access_token = Column(Text, nullable=False)
    refresh_token = Column(Text, nullable=False)
    token_expires_at = Column(DateTime, nullable=False)
    site_id = Column(String(10), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())


class MLSettings(Base):
    __tablename__ = "ml_settings"

    id = Column(Integer, primary_key=True, index=True)
    ml_account_id = Column(Integer, ForeignKey("ml_accounts.id"), nullable=False)
    default_listing_type_id = Column(String(50))
    default_currency_id = Column(String(10))
    auto_pause_on_zero_stock = Column(Boolean, nullable=False, server_default="true")
    auto_relist_on_stock = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())


class SEOConfig(Base):
    __tablename__ = "seo_config"

    id = Column(Integer, primary_key=True, index=True)
    llm_provider = Column(String(50), nullable=False)
    max_title_length = Column(Integer, nullable=False, server_default="60")
    language_code = Column(String(10), nullable=False, server_default="es_AR")
    title_pattern = Column(String(255), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())


class ImageConfig(Base):
    __tablename__ = "image_config"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String(50), nullable=False)
    results_per_product = Column(Integer, nullable=False, server_default="5")
    canvas_width = Column(Integer, nullable=False, server_default="1200")
    canvas_height = Column(Integer, nullable=False, server_default="1200")
    background_color = Column(String(20), nullable=False, server_default="#FFFFFF")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())


class MLPublicationLog(Base):
    __tablename__ = "ml_publication_logs"

    id = Column(Integer, primary_key=True, index=True)
    ml_account_id = Column(Integer, ForeignKey("ml_accounts.id"), nullable=False)
    local_product_id = Column(String(100), nullable=False)
    ml_item_id = Column(String(50))
    action = Column(String(50), nullable=False)
    status = Column(String(20), nullable=False)
    http_status_code = Column(Integer)
    ml_error_code = Column(String(100))
    ml_error_message = Column(Text)
    payload_sent = Column(JSON)
    response_received = Column(JSON)
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class ImageProcessingLog(Base):
    __tablename__ = "image_processing_logs"

    id = Column(Integer, primary_key=True, index=True)
    local_product_id = Column(String(100), nullable=False)
    source_image_url = Column(Text)
    provider = Column(String(50), nullable=False)
    processed_image_url = Column(Text)
    status = Column(String(20), nullable=False)
    error_message = Column(Text)
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class SEOGenerationLog(Base):
    __tablename__ = "seo_generation_logs"

    id = Column(Integer, primary_key=True, index=True)
    local_product_id = Column(String(100), nullable=False)
    llm_provider = Column(String(50), nullable=False)
    base_name = Column(Text, nullable=False)
    generated_title = Column(Text)
    generated_description = Column(Text)
    generated_keywords = Column(Text)
    status = Column(String(20), nullable=False)
    error_message = Column(Text)


class Lead(Base):
    __tablename__ = "leads"

    id = Column(Integer, primary_key=True, index=True)
    platform = Column(String(50), nullable=False)  # whatsapp, marketplace, mercadolibre
    remote_id = Column(String(255), nullable=False, index=True)  # phone number or user ID
    name = Column(String(255))
    status = Column(String(50), default="new")  # new, contacted, interested, closed
    priority = Column(Integer, default=0)  # 1=High (WA), 2=Medium (Marketplace), 3=Low (ML)
    last_message_at = Column(DateTime, server_default=func.now())
    created_at = Column(DateTime, server_default=func.now())

    messages = relationship("Message", back_populates="lead")


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=False)
    content = Column(Text, nullable=False)
    sender = Column(String(50), nullable=False)  # user, bot, agent
    timestamp = Column(DateTime, server_default=func.now())
    is_read = Column(Boolean, default=False)
    status = Column(String(20), default="sent")  # pending, sent, delivered, read, failed
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    lead = relationship("Lead", back_populates="messages")


class StockSyncLog(Base):
    __tablename__ = "stock_sync_logs"

    id = Column(Integer, primary_key=True, index=True)
    ml_account_id = Column(Integer, ForeignKey("ml_accounts.id"), nullable=False)
    local_product_id = Column(String(100), nullable=False)
    ml_item_id = Column(String(50))
    previous_stock = Column(Integer)
    new_stock = Column(Integer)
    status = Column(String(20), nullable=False)
    error_message = Column(Text)
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class LocalProduct(Base):
    __tablename__ = "local_products"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    sku = Column(String(100), nullable=True, index=True)
    category = Column(String(100), nullable=True)
    price = Column(Numeric(10, 2), nullable=False)
    stock = Column(Integer, nullable=False, default=0)
    image_url = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
