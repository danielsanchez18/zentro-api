# AGENTS.md — Backend (zentro-api)

> **Archivo de navegación para agentes IA.** Si eres un agente trabajando en este proyecto, lee esto primero.

## 📋 ¿En qué vas a trabajar?

### Primero, lee el plan maestro
→ **`docs/03-ROADMAP.md`** — contiene todas las tareas, su estado y dependencias (5 min)

### Luego, según tu tarea:

| Si tu tarea es sobre | Lee primero | Archivos que tocarás |
|---|---|---|
| **Auth** (login, register, JWT, forgot-password) | `docs/agents/backend/auth/README.md` | `src/modules/auth/*`, `src/modules/mail/*`, `prisma/schema.prisma` |
| **Correo / email** (envíos, Resend) | `docs/agents/backend/auth/README.md`, `docs/decisions/004-password-recovery.md` | `src/modules/mail/*`, `zentro-api/.env` |
| **Users** (CRUD, perfiles) | `docs/agents/backend/users/README.md` | `src/modules/users/*`, `prisma/schema.prisma` |
| **Multi-tenant / Organizaciones** | Notion 04 + 06 | `src/modules/org/*`, `prisma/schema.prisma` |
| **Roles y permisos** | Notion 04 (Roles capacidad) | `src/modules/roles/*` |
| **Catálogo / Productos** | Notion 04 + docs | `src/modules/catalog/*` |
| **Arquitectura general** | `docs/02-ARCHITECTURE.md`, Notion 06 | — |
| **Setup / configuración** | `src/main.ts`, `app.module.ts`, `config/*` | `nest-cli.json`, `tsconfig.json` |

## 🚫 Reglas

- No modifiques archivos fuera del módulo que te corresponde.
- No instales dependencias sin consultar.
- No generes migraciones Prisma sin revisar el schema primero.
- Siempre verifica `docs/03-ROADMAP.md` para ver el estado actual de tu tarea.

## 📁 Estructura del proyecto

```
src/
├── main.ts                    # Entry point
├── app.module.ts              # Módulo raíz
├── modules/
│   ├── auth/                  # Auth: registro, login, JWT, forgot-password
│   ├── mail/                  # Correo: drivers log/resend (usado por Auth)
│   ├── users/                 # Users: CRUD, perfiles
│   ├── org/                   # Organizaciones + sucursales (futuro)
│   ├── roles/                 # Roles y permisos (futuro)
│   ├── catalog/               # Catálogo de productos (futuro)
│   └── ...                    # Más módulos según roadmap
├── common/                    # Código compartido (guards, decorators)
├── config/                    # Configuración
└── prisma/                    # Prisma module + service
```

## 🧭 Documentación relacionada

| Archivo | Para qué |
|---|---|
| **`docs/03-ROADMAP.md`** | **Plan maestro: tareas, estado, dependencias** |
| `docs/backend/README.md` | Visión general del backend |
| `docs/progress/CURRENT.md` | Tarea activa actual |
| `docs/progress/NEXT.md` | Próximas tareas en orden |
| `docs/decisions/*.md` | Decisiones arquitectónicas |
| Notion (04 - Modelo de Dominio) | Entidades y relaciones |
| Notion (05 - Arquitectura Funcional) | Flujos, casos de uso, reglas |
| Notion (06 - Arquitectura Técnica) | Stack, patrones, auth, hosting |
