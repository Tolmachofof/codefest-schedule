#!/usr/bin/env python3
"""Create or update a user.

Usage:
    python create_user.py <username> <password>
"""
import sys
from database import Base, engine, SessionLocal
import models
from auth import hash_password

Base.metadata.create_all(bind=engine)


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: python create_user.py <username> <password>")
        sys.exit(1)

    username, password = sys.argv[1], sys.argv[2]
    if len(password.encode()) > 72:
        print("Ошибка: пароль не должен превышать 72 байта")
        sys.exit(1)
    db = SessionLocal()
    try:
        user = db.query(models.User).filter(models.User.username == username).first()
        if user:
            user.hashed_password = hash_password(password)
            db.commit()
            print(f"Password updated for user '{username}'")
        else:
            db.add(models.User(username=username, hashed_password=hash_password(password)))
            db.commit()
            print(f"User '{username}' created successfully")
    finally:
        db.close()


if __name__ == "__main__":
    main()
