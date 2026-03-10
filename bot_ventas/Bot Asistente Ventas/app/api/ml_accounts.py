from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import SessionLocal


router = APIRouter(prefix="/api/ml/accounts", tags=["Mercado Libre Accounts"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/", response_model=list[schemas.MLAccount])
def list_ml_accounts(db: Session = Depends(get_db)):
    accounts = db.query(models.MLAccount).all()
    return accounts
