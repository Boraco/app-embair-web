from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Meli Optimizer Hub"
    database_url: str = "sqlite:///./meli_optimizer.db"
    meli_client_id: str | None = None
    meli_client_secret: str | None = None
    meli_redirect_uri: str | None = None
    meli_site_id: str = "MLA"
    ml_user: str | None = None
    ml_pass: str | None = None
    openai_api_key: str | None = None

    class Config:
        env_file = ".env"
        extra = "ignore"  # Ignorar variables extra en el .env


settings = Settings()
