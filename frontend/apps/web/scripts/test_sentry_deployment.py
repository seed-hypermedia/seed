"""Regression for prebuilt browser and server Sentry deployment wiring.

The fourth assertion failed on exact main 9a224eb3c72cc8feb67483ec8f8b734cac0e7bfb.
Run: python3 -m unittest frontend/apps/web/scripts/test_sentry_deployment.py
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[4]

class WebSentryDeployment(unittest.TestCase):
    def test_web_builds_supply_dsn_release_and_environment(self):
        for workflow, environment in (('release-docker-images', 'production'),
                                      ('dev-docker-images', 'development'),
                                      ('custom-ghcr-images', 'production')):
            with self.subTest(workflow=workflow):
                text = (ROOT / '.github/workflows' / (workflow + '.yml')).read_text()
                build = text.split('- name: Build Web App', 1)[1].split('- name:', 1)[0]
                self.assertIn('SITE_SENTRY_DSN: ${{ secrets.SITE_SENTRY_DSN }}', build)
                self.assertIn('SITE_SENTRY_RELEASE: ${{ github.sha }}', build)
                self.assertIn(f'SITE_SENTRY_ENVIRONMENT: {environment}', build)
                image = text.split('file: frontend/apps/web/Dockerfile', 1)[1].split('cache-from:', 1)[0]
                self.assertIn('SITE_SENTRY_DSN=${{ secrets.SITE_SENTRY_DSN }}', image)
                self.assertIn(f'SITE_SENTRY_ENVIRONMENT={environment}', image)
                self.assertIn('PREBUILT=true', image)

    def test_production_image_exposes_overridable_runtime_dsn(self):
        text = (ROOT / 'frontend/apps/web/Dockerfile').read_text()
        builder, production = text.split('FROM node:22-alpine AS production', 1)
        self.assertIn('ARG SITE_SENTRY_DSN', builder)
        self.assertIn('ARG SITE_SENTRY_DSN', production)
        self.assertIn('ENV SITE_SENTRY_DSN=${SITE_SENTRY_DSN}', production)
        self.assertIn('ARG SITE_SENTRY_ENVIRONMENT=production', production)
        self.assertIn('ENV SITE_SENTRY_ENVIRONMENT=${SITE_SENTRY_ENVIRONMENT}', production)
        self.assertNotIn('ENV SITE_SENTRY_RELEASE=', production)
        server = (ROOT / 'frontend/apps/web/instrumentation.server.mjs').read_text()
        self.assertIn('process.env.SITE_SENTRY_DSN', server)
        self.assertIn("readFileFirstLine('COMMIT_HASH')", server)
        self.assertIn('process.env.SITE_SENTRY_ENVIRONMENT', server)

if __name__ == '__main__':
    unittest.main()
