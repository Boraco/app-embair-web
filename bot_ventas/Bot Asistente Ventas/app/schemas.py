from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel


class MLAccountBase(BaseModel):
    name: str
    meli_user_id: int
    site_id: str


class MLAccountCreate(MLAccountBase):
    access_token: str
    refresh_token: str
    token_expires_at: datetime


class MLAccount(MLAccountBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MLSettingsBase(BaseModel):
    default_listing_type_id: Optional[str] = None
    default_currency_id: Optional[str] = None
    auto_pause_on_zero_stock: bool = True
    auto_relist_on_stock: bool = False


class MLSettingsUpdate(MLSettingsBase):
    pass


class MLSettings(MLSettingsBase):
    id: int
    ml_account_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class LocalProductBase(BaseModel):
    name: str
    sku: Optional[str] = None
    category: Optional[str] = None
    price: Decimal
    stock: int
    image_url: Optional[str] = None
    description: Optional[str] = None


class LocalProduct(LocalProductBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MessageBase(BaseModel):
    content: str
    sender: str
    status: Optional[str] = "sent"


class MessageCreate(MessageBase):
    lead_id: int
    is_read: Optional[bool] = False


class Message(MessageBase):
    id: int
    lead_id: int
    timestamp: datetime
    is_read: bool
    lead: Optional[LeadBase] = None

    class Config:
        from_attributes = True


class LeadBase(BaseModel):
    platform: str
    remote_id: str
    name: Optional[str] = None
    status: Optional[str] = "new"
    priority: Optional[int] = 0


class LeadCreate(LeadBase):
    pass


class Lead(LeadBase):
    id: int
    last_message_at: datetime
    created_at: datetime
    messages: list[Message] = []

    class Config:
        from_attributes = True


class IncomingMessage(BaseModel):
    platform: str
    remote_id: str
    sender_name: Optional[str] = "Desconocido"
    content: str
    timestamp: Optional[datetime] = None
    sender_type: Optional[str] = "user"


class ReplyRequest(BaseModel):
    content: str


class LeadStatusUpdate(BaseModel):
    status: str
