from pydantic import BaseModel


class SecretSet(BaseModel):
    key: str
    value: str
