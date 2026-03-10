from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("/webhook", response_model=schemas.Message)
def receive_message(msg: schemas.IncomingMessage, db: Session = Depends(get_db)):
    # Find or create Lead
    lead = db.query(models.Lead).filter(
        models.Lead.platform == msg.platform,
        models.Lead.remote_id == msg.remote_id
    ).first()

    if not lead:
        # Determine priority
        priority = 0
        if msg.platform == "whatsapp":
            priority = 3  # High
        elif msg.platform == "marketplace":
            priority = 2  # Medium
        elif msg.platform == "mercadolibre":
            priority = 1  # Low

        lead = models.Lead(
            platform=msg.platform,
            remote_id=msg.remote_id,
            name=msg.sender_name,
            priority=priority,
            status="new"
        )
        db.add(lead)
        db.commit()
        db.refresh(lead)
    else:
        # Update name if changed
        if msg.sender_name and msg.sender_name != "Desconocido":
            lead.name = msg.sender_name
        
        lead.last_message_at = models.func.now()
        
        # Smart Status Update
        if msg.sender_type == "user":
            content_lower = msg.content.lower()
            # Keywords for "interested" / "attention needed"
            keywords = ["asesor", "humano", "compra", "precio", "interesa", "quiero", "informacion"]
            
            if any(kw in content_lower for kw in keywords):
                lead.status = "interested"
            elif lead.status in ["closed", "sale", "not_interested"]:
                lead.status = "new"  # Reopen conversation
                
        elif msg.sender_type == "agent":
            # If bot/agent replies to a new lead, mark as contacted
            if lead.status == "new":
                lead.status = "contacted"
                
        db.commit()

    # Create Message
    new_message = models.Message(
        lead_id=lead.id,
        content=msg.content,
        sender=msg.sender_type,  # Use sender_type from request (user or agent)
        is_read=True if msg.sender_type == "agent" else False,
        status="sent" if msg.sender_type == "agent" else "received",
        timestamp=msg.timestamp or models.func.now()
    )
    db.add(new_message)
    db.commit()
    db.refresh(new_message)

    return new_message


@router.get("/leads", response_model=List[schemas.Lead])
def get_leads(
    platform: Optional[str] = None,
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    query = db.query(models.Lead)
    if platform:
        query = query.filter(models.Lead.platform == platform)
    if status:
        query = query.filter(models.Lead.status == status)
    
    # Order by priority (desc) and last_message_at (desc)
    query = query.order_by(desc(models.Lead.priority), desc(models.Lead.last_message_at))
    
    return query.offset(skip).limit(limit).all()


@router.get("/leads/{lead_id}", response_model=schemas.Lead)
def get_lead(lead_id: int, db: Session = Depends(get_db)):
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


@router.put("/leads/{lead_id}/status")
def update_lead_status(lead_id: int, status_update: schemas.LeadStatusUpdate, db: Session = Depends(get_db)):
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    lead.status = status_update.status
    db.commit()
    return {"status": "success", "new_status": status_update.status}


@router.get("/leads/{lead_id}/messages", response_model=List[schemas.Message])
def get_messages(lead_id: int, db: Session = Depends(get_db)):
    messages = db.query(models.Message).filter(models.Message.lead_id == lead_id).order_by(models.Message.timestamp).all()
    # Mark messages as read
    unread = [m for m in messages if not m.is_read and m.sender == "user"]
    if unread:
        for m in unread:
            m.is_read = True
        db.commit()
    return messages


@router.post("/leads/{lead_id}/reply", response_model=schemas.Message)
def reply_to_lead(lead_id: int, reply: schemas.ReplyRequest, db: Session = Depends(get_db)):
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    new_message = models.Message(
        lead_id=lead.id,
        content=reply.content,
        sender="agent",
        is_read=True,
        status="pending"  # Bot needs to pick this up
    )
    db.add(new_message)
    
    # Update lead status
    if lead.status == "new":
        lead.status = "contacted"
    
    db.commit()
    db.refresh(new_message)
    return new_message


@router.get("/pending-replies/{platform}", response_model=List[schemas.Message])
def get_pending_replies(platform: str, db: Session = Depends(get_db)):
    # Join with Lead to filter by platform and load relationship
    messages = db.query(models.Message).join(models.Lead).options(joinedload(models.Message.lead)).filter(
        models.Message.status == "pending",
        models.Message.sender == "agent",
        models.Lead.platform == platform
    ).all()
    return messages


@router.post("/messages/{message_id}/confirm")
def confirm_message_sent(message_id: int, db: Session = Depends(get_db)):
    message = db.query(models.Message).filter(models.Message.id == message_id).first()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    
    message.status = "sent"
    db.commit()
    return {"status": "success"}
