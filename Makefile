.PHONY: help install install-backend install-frontend dev dev-backend dev-frontend test test-backend test-frontend test-e2e docker-build docker-up docker-down docker-logs clean lint format

# Default target
help: ## Show this help message
	@echo "DRS Development Makefile"
	@echo ""
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'

# Installation
install: install-backend install-frontend ## Install all dependencies

install-backend: ## Install Python backend dependencies
	cd backend && python -m pip install -r requirements-test.txt

install-frontend: ## Install Node.js frontend dependencies
	cd frontend && npm ci

# Development servers
dev: ## Start both backend and frontend development servers
	@echo "Starting DRS development environment..."
	@make -j2 dev-backend dev-frontend

dev-backend: ## Start backend development server
	cd backend && python run_server.py

dev-frontend: ## Start frontend development server
	cd frontend && npm start

# Testing
test: test-backend test-frontend ## Run all tests

test-backend: ## Run backend tests
	cd backend && python -m pytest tests/ -q
	python scripts/generate_standard_deliveries.py --check

test-frontend: ## Run frontend tests
	cd frontend && npm test -- --watchAll=false --runInBand

test-e2e: ## Run the fixture browser audit (set CHROMIUM to the executable path)
	cd frontend && REACT_APP_API_BASE_URL=http://localhost:8000 npm run build
	node scripts/audit_ui.cjs "$(CHROMIUM)" docs/ui-audit/fixture.json tmp/ui-audit

# Docker commands
docker-build: ## Build Docker images
	docker-compose build

docker-up: ## Start all Docker services
	docker-compose up -d
	@echo "DRS is running at:"
	@echo "  Frontend: http://localhost:3000"
	@echo "  Backend:  http://localhost:8000"
	@echo "  API Docs: http://localhost:8000/docs"

docker-down: ## Stop all Docker services
	docker-compose down

docker-logs: ## Show Docker logs
	docker-compose logs -f

# Code quality
lint: ## Run linting on both backend and frontend
	cd backend && black --check src/ && isort --check-only src/
	cd frontend && npm run lint

format: ## Format code in both backend and frontend
	cd backend && black src/ && isort src/
	cd frontend && npm run format

# Cleanup
clean: ## Clean up temporary files and caches
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type d -name node_modules -exec rm -rf {} +
	find . -type d -name .pytest_cache -exec rm -rf {} +
	find . -name "*.pyc" -delete
	find . -name "*.pyo" -delete
	find . -name ".coverage" -delete
	cd frontend && npm run clean

# Database
db-reset: ## Reset database (development only)
	docker-compose down -v
	docker-compose up -d db
	@echo "Database reset complete"

# Production
build-prod: ## Build for production
	docker-compose -f docker-compose.yml --profile production build

deploy-prod: ## Deploy to production
	docker-compose -f docker-compose.yml --profile production up -d

# Quick setup for new developers
setup: ## Complete setup for new developers
	@echo "Setting up DRS development environment..."
	make install
	make docker-build
	make docker-up
	@echo "Setup complete! Visit http://localhost:3000"
