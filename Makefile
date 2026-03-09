.PHONY: up down build logs ps create-user test

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
