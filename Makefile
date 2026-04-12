.PHONY: up down build logs ps create-user test \
        db-stamp db-migrate db-revision db-history \
        download-certs

up:
	docker compose up -d

down:
	docker compose down

build:
	docker compose up -d --build

logs:
	docker compose logs -f

ps:
	docker compose ps

create-user:
	@read -p "Username: " u; read -s -p "Password: " p; echo; \
	docker compose exec backend python create_user.py $$u $$p

test:
	docker compose exec backend python -m pytest test_main.py -v

# --- GigaChat SSL certificates ---

# Скачивает корневые сертификаты Минцифры для SSL-верификации GigaChat (Сбер).
# Нужно запустить один раз перед первым использованием GigaChat.
download-certs:
	@echo "Скачиваем сертификаты Минцифры для GigaChat..."
	@mkdir -p backend/certs
	@curl -fsSL "https://gu-st.ru/content/Other/doc/russian_trusted_root_ca.cer" \
		| python3 -c "import sys; sys.stdout.buffer.write(sys.stdin.buffer.read().replace(b'\r\n', b'\n'))" \
		> backend/certs/russian_trusted_root_ca.pem
	@curl -fsSL "https://gu-st.ru/content/Other/doc/russian_trusted_sub_ca.cer" \
		| python3 -c "import sys; sys.stdout.buffer.write(sys.stdin.buffer.read().replace(b'\r\n', b'\n'))" \
		> backend/certs/russian_trusted_sub_ca.pem
	@cat backend/certs/russian_trusted_root_ca.pem backend/certs/russian_trusted_sub_ca.pem \
		> backend/certs/sber_ca_bundle.pem
	@echo "Готово: backend/certs/sber_ca_bundle.pem"

# --- Database migrations (Alembic) ---

# Пометить существующую БД как актуальную (запускать один раз на уже развёрнутом стенде)
db-stamp:
	docker compose exec backend alembic stamp head

# Применить все pending-миграции (новый деплой или после alembic revision)
db-migrate:
	docker compose exec backend alembic upgrade head

# Создать новую автомиграцию: make db-revision MSG="add foo column"
db-revision:
	docker compose exec backend alembic revision --autogenerate -m "$(MSG)"

# Показать историю миграций
db-history:
	docker compose exec backend alembic history --verbose
