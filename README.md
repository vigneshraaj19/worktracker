# react-app-cicd

Drop these files into the root of your **existing React repo** (the one
already on GitHub). This is the app-side CI/CD only — it does not create any
AWS infrastructure. That lives in a separate `terraform-infra` repo, which
must be applied first.

## Layout
```
docker/Dockerfile      # multi-stage build: npm build -> nginx
docker/nginx.conf       # SPA routing (react-router) + static asset caching
.github/workflows/deploy.yml   # build image, push to ECR, deploy to ECS
```

## Prerequisites
The `terraform-infra` repo must already be applied. You need these outputs
from it:
```bash
terraform output github_actions_role_arn
terraform output ecr_repository_url
terraform output ecs_cluster_name
terraform output ecs_service_name
```

## Setup

### 1. Copy files in
Copy `docker/` and `.github/workflows/deploy.yml` into your React repo root.

### 2. Point the Dockerfile at your build output
`docker/Dockerfile` defaults to Create React App's `/app/build`. Using Vite?
Change that line to `/app/dist`.

### 3. Add the AWS role as a repo variable
No AWS keys needed — this uses OIDC, trusting only this specific repo
(configured on the `terraform-infra` side). In **this repo's** GitHub
Settings → Secrets and variables → Actions → Variables, add:
- `AWS_GITHUB_ACTIONS_ROLE_ARN` = the `github_actions_role_arn` output above

### 4. Match the workflow's resource names
Open `.github/workflows/deploy.yml` and confirm the `env:` block matches the
actual names from terraform-infra's outputs (`ecr_repository_url`,
`ecs_cluster_name`, `ecs_service_name`, and the container name, which is
`${project_name}-container`).

### 5. Push to main
```bash
git add .
git commit -m "Add CI/CD pipeline"
git push origin main
```
This builds your app into a Docker image, pushes it to ECR, and rolls out a
new ECS deployment. Watch progress in the Actions tab.

### 6. Visit your app
Get the URL from the terraform-infra repo:
```bash
terraform output alb_dns_name
```
