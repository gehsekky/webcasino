#!/bin/sh

cd /app
npx prisma generate
npm run start
