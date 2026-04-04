# calibre-workers

`calibre-workers` is a serverless ebook management and conversion platform built on Cloudflare Workers, R2, D1, Queues, and Containers. The project aims to provide a lightweight, fast, cloud-native alternative to Calibre for managing, reading, and converting ebooks.

## What is this project?

This is a full-stack application that combines a modern frontend with Cloudflare edge infrastructure:

- **Serverless full-stack architecture**: the frontend uses React + TanStack Start, and the backend runs on Cloudflare Workers.
- **Cloud ebook storage (R2)**: ebook files are stored in a low-cost, reliable Cloudflare R2 bucket (`calibre-books`).
- **Relational database (D1)**: Cloudflare D1 and Drizzle ORM are used to manage structured book metadata such as authors, categories, series, and tags.
- **Asynchronous task processing (Queues)**: Cloudflare Queues handle background jobs such as metadata extraction and pending conversion tasks.
- **Cloud-based conversion (Containers)**: Cloudflare Containers run the conversion environment, powered by Go, with support for common formats such as `epub`, `kepub`, `azw3`, and `mobi`.
- **User and access management**: built-in Better Auth authentication provides secure multi-user access control.

## Why does this project exist?

I used calibre-web for about two years to run my personal online library. It solved the multi-device reading problem, but after a while I started seeing unexplained upload failures and conversion issues. The UI/UX also was not great, and the traditional setup still required me to maintain a server and pay for VPS hosting.

To solve those pain points, I decided to redesign the entire ebook and conversion stack and move everything to Cloudflare. `calibre-workers` uses Cloudflare's serverless ecosystem to provide:

1. **Zero ops hosting**: no NAS, no always-on server, and no manual infrastructure maintenance.
2. **Low operating cost**: Cloudflare's R2, D1, and Workers services are a good fit for a personal ebook library.
3. **Cloud-native conversion capacity**: expensive conversion work runs inside Cloudflare Containers, so local machines are not burdened by it.

---

## Deployment

### Prerequisites

- A Cloudflare account connected to your GitHub account
- Permission to deploy Cloudflare Workers from that account
- Cloudflare Workers Paid Subscription, so that you can use Cloudflare Containers for the conversion environment.

### One-click deploy

Click the button below to open Cloudflare's deploy flow. Cloudflare will guide you through creating and binding the resources this project needs, including R2, D1, and Queues:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/LiaoAnn/calibre-workers)

### Deploy flow

1. Click the Deploy button and authorize Cloudflare.
2. Review or adjust the project and resource names, then set:
   - Build Command: `pnpm run build`
   - Deploy Command: `pnpm run deploy`
3. Click Create and deploy to finish the initial deployment.

### Manual follow-up after deployment

#### 1. Set secrets

Add the following variables in the Cloudflare Dashboard for the new project:

- `BETTER_AUTH_SECRET`: a random, high-entropy secret string
- `BETTER_AUTH_URL`: your production Worker URL or custom domain, should be https://calibre.workers.yourname.workers.dev or https://library.yourdomain.com

> `pnpm run deploy` already includes `pnpm run db:apply --remote`, so migrations are applied automatically during deployment and do not need to be run manually.

#### 2. Register

The first time you access the deployed Worker URL, you will see the registration page. Create an account with your email and a password. This account will be the admin user for the library, and you can create additional users from the settings page after logging in.

---

## Development

This project uses TypeScript and `pnpm`. The frontend is built with Vite-based [TanStack Start](https://tanstack.com/router), and the backend uses [Effect](https://effect.website/) for asynchronous workflows, state management, and type-safe error handling.

### 0. Open the dev container

Use VS Code's **Dev Containers** or **Remote - Containers** extension to open the environment defined in `.devcontainer/docker-compose.yml`. The setup already includes the services and tools needed for local development:

- `docker.sock`: required so Cloudflare Containers can launch through the local Docker CLI
- `pnpm_store`: binds the pnpm cache to the container so dependencies do not need to be downloaded again on every rebuild

This project always uses Cloudflare Containers during development, so `docker.sock` must remain mounted.

### 1. Install dependencies

```bash
pnpm install
```

### 2. Start the local dev environment

```bash
pnpm dev
```

This is the main development command. It starts the local development server and Wrangler's emulation environment so you can work at `http://localhost:8787`.

### 3. Database workflow

The database schema lives in `src/db/schema.ts` and is managed with Drizzle ORM. When the schema changes, the two usual commands are:

```bash
pnpm db:generate
pnpm db:apply
```

The first command generates migrations, and the second applies them to the current environment. Remote migration application is also handled automatically by `pnpm run deploy`.

### 4. Linting and formatting

```bash
pnpm format
pnpm lint
pnpm check
```

### 5. Converter tests

If you change the Go-based conversion code under `src/containers/converter/`, run:

```bash
pnpm test:converter
pnpm test:converter:integration
```