# Cognitive trails — build pipeline.
#
#   raw web data ──(1_download)──▶ source_data/  ──(2_build_ontology)──▶ source_data/*.ttl
#        │                                                                     │
#        │                                                       (compile_ttl)─┘
#        ▼                                                                     ▼
#   gpx/ images/ tracks_raw.json                                  src/generated/trails.ts
#                                                                              │
#                                                                   (vite build) ──▶ dist/
#
# Common usage:
#   make build      # install deps if needed, compile TTL, produce dist/
#   make preview    # serve the built dist/ over HTTP
#   make dev        # run the Vite dev server
#   make data       # (re)scrape + rebuild ontology from the live site (network)

PY  := $(if $(wildcard .venv/bin/python),.venv/bin/python,python3)
NPM := npm

.DEFAULT_GOAL := help

.PHONY: help install data download ontology compile build dev preview serve clean distclean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

node_modules: package.json ## Install npm dependencies when missing/stale
	$(NPM) install
	@touch node_modules

install: node_modules ## Install all dependencies

download: ## Scrape trails from nesedeknamuose.lt into source_data/ (network)
	$(PY) scripts/1_download.py

ontology: ## Translate + emit source_data/ontology.ttl and data.ttl (network)
	$(PY) scripts/2_build_ontology.py

data: download ontology ## Full data refresh: scrape then rebuild the ontology

compile: ## Compile source_data/*.ttl into src/generated/trails.ts
	$(NPM) run compile:data

build: node_modules ## Compile TTL + type-check + bundle to dist/
	$(NPM) run build

dev: node_modules ## Run the Vite dev server (http://localhost:5173)
	$(NPM) run dev

preview: ## Serve the built dist/ over HTTP (http://localhost:4173)
	$(NPM) run preview

serve: build ## Build, serve over HTTP, and open the browser (double-clicking the HTML can't work — browsers block file://)
	@( sleep 1 && open http://localhost:4173/ ) &
	$(NPM) run preview

clean: ## Remove build outputs (dist/, generated TS)
	rm -rf dist src/generated

distclean: clean ## Also remove installed npm dependencies
	rm -rf node_modules
