#!/bin/sh

# Prisma client is generated at image build time via the postinstall
# hook (see package.json + Dockerfile), so no generate step needed here.
cd /app
npm run start
