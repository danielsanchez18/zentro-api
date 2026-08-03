// Seed de Zentro API
// Se ejecuta con: node --import tsx prisma/seed.ts  (vía prisma db seed)
// Siembra datos globales de referencia (idempotente):
//   - Planes (trial, esencial, crecimiento, profesional, enterprise)
//   - Catálogo global de Permission (códigos de las capacidades de Notion 04)
// NOTA: El rol "Owner" NO se siembra aquí (decisión 3.6): se crea por-org al
// crear cada organización, con todos los permisos del catálogo.
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not defined in environment');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// ---------------------------------------------------------------
// Planes
// ---------------------------------------------------------------
const PLANS = [
  {
    slug: 'trial',
    name: 'Trial',
    description: 'Prueba todas las capacidades por 30 días con límites acotados.',
    price: 0,
    currency: 'USD',
    interval: 'month',
    limits: { users: 3, branches: 1, products: 500 },
    features: ['*'],
    storageLimit: 1024, // 1 GB
    transactionLimit: 50,
    active: true,
  },
  {
    slug: 'esencial',
    name: 'Esencial',
    description: 'Para negocios en arranque: Ventas, Catálogo y Clientes.',
    price: 19,
    currency: 'USD',
    interval: 'month',
    limits: { users: 3, branches: 1, products: 500 },
    features: ['ventas', 'catalogo', 'clientes'],
    storageLimit: 1024,
    transactionLimit: 500,
    active: true,
  },
  {
    slug: 'crecimiento',
    name: 'Crecimiento',
    description: 'Agrega Inventario y Presencia digital.',
    price: 49,
    currency: 'USD',
    interval: 'month',
    limits: { users: 8, branches: 3, products: 2000 },
    features: ['ventas', 'catalogo', 'clientes', 'inventario', 'presencia'],
    storageLimit: 5120,
    transactionLimit: 5000,
    active: true,
  },
  {
    slug: 'profesional',
    name: 'Profesional',
    description: 'Todo lo anterior más Finanzas y reportes avanzados.',
    price: 99,
    currency: 'USD',
    interval: 'month',
    limits: { users: 20, branches: 10, products: 10000 },
    features: ['ventas', 'catalogo', 'clientes', 'inventario', 'presencia', 'finanzas'],
    storageLimit: 20480,
    transactionLimit: 50000,
    active: true,
  },
  {
    slug: 'enterprise',
    name: 'Enterprise',
    description: 'Límites a medida, soporte premium y API.',
    price: 0,
    currency: 'USD',
    interval: 'month',
    limits: { users: -1, branches: -1, products: -1 },
    features: ['*'],
    storageLimit: 0,
    transactionLimit: 0,
    active: true,
  },
];

// ---------------------------------------------------------------
// Catálogo de permisos (códigos de las capacidades de Notion 04)
// Formato: { code, name, group }. scope ORG salvo Auditoría/GLOBAL.
// ---------------------------------------------------------------
const PERMISSIONS: { code: string; name: string; group: string; scope?: string }[] = [
  // Auditoría
  { code: 'AUDIT.READ', name: 'Leer auditoría', group: 'AUDIT', scope: 'ORG' },

  // Ventas / POS
  { code: 'SALES.READ', name: 'Leer ventas', group: 'SALES' },
  { code: 'SALES.CREATE', name: 'Crear ventas', group: 'SALES' },
  { code: 'SALES.UPDATE', name: 'Actualizar ventas', group: 'SALES' },
  { code: 'SALES.VOID', name: 'Anular ventas', group: 'SALES' },
  { code: 'CASH.READ', name: 'Leer caja', group: 'SALES' },
  { code: 'CASH.MANAGE', name: 'Gestionar caja', group: 'SALES' },
  { code: 'ORDERS.READ', name: 'Leer pedidos', group: 'SALES' },
  { code: 'ORDERS.CREATE', name: 'Crear pedidos', group: 'SALES' },
  { code: 'ORDERS.UPDATE', name: 'Actualizar pedidos', group: 'SALES' },
  { code: 'PAYMENTS.READ', name: 'Leer pagos', group: 'SALES' },
  { code: 'PAYMENTS.PROCESS', name: 'Procesar pagos', group: 'SALES' },

  // Catálogo
  { code: 'PRODUCTS.READ', name: 'Leer productos', group: 'PRODUCTS' },
  { code: 'PRODUCTS.CREATE', name: 'Crear productos', group: 'PRODUCTS' },
  { code: 'PRODUCTS.UPDATE', name: 'Actualizar productos', group: 'PRODUCTS' },
  { code: 'PRODUCTS.DELETE', name: 'Eliminar productos', group: 'PRODUCTS' },
  { code: 'CATEGORIES.READ', name: 'Leer categorías', group: 'PRODUCTS' },
  { code: 'CATEGORIES.MANAGE', name: 'Gestionar categorías', group: 'PRODUCTS' },

  // Clientes / CRM
  { code: 'CLIENTS.READ', name: 'Leer clientes', group: 'CLIENTS' },
  { code: 'CLIENTS.CREATE', name: 'Crear clientes', group: 'CLIENTS' },
  { code: 'CLIENTS.UPDATE', name: 'Actualizar clientes', group: 'CLIENTS' },
  { code: 'CLIENTS.DELETE', name: 'Eliminar clientes', group: 'CLIENTS' },
  { code: 'CRM.READ', name: 'Leer CRM', group: 'CLIENTS' },
  { code: 'CRM.CREATE', name: 'Crear oportunidades CRM', group: 'CLIENTS' },
  { code: 'CRM.UPDATE', name: 'Actualizar oportunidades CRM', group: 'CLIENTS' },
  { code: 'APPOINTMENTS.READ', name: 'Leer agenda', group: 'CLIENTS' },
  { code: 'APPOINTMENTS.MANAGE', name: 'Gestionar agenda', group: 'CLIENTS' },
  { code: 'FORMS.READ', name: 'Leer formularios', group: 'CLIENTS' },
  { code: 'FORMS.MANAGE', name: 'Gestionar formularios', group: 'CLIENTS' },

  // Inventario
  { code: 'INVENTORY.READ', name: 'Leer inventario', group: 'INVENTORY' },
  { code: 'INVENTORY.UPDATE', name: 'Actualizar stock', group: 'INVENTORY' },
  { code: 'PURCHASES.READ', name: 'Leer compras', group: 'INVENTORY' },
  { code: 'PURCHASES.CREATE', name: 'Crear compras', group: 'INVENTORY' },
  { code: 'SUPPLIERS.READ', name: 'Leer proveedores', group: 'INVENTORY' },
  { code: 'SUPPLIERS.MANAGE', name: 'Gestionar proveedores', group: 'INVENTORY' },
  { code: 'TRANSFERS.MANAGE', name: 'Gestionar transferencias', group: 'INVENTORY' },

  // Presencia digital
  { code: 'WEB.READ', name: 'Leer web', group: 'PRESENCE' },
  { code: 'WEB.EDIT', name: 'Editar web', group: 'PRESENCE' },
  { code: 'BLOG.READ', name: 'Leer blog', group: 'PRESENCE' },
  { code: 'BLOG.MANAGE', name: 'Gestionar blog', group: 'PRESENCE' },
  { code: 'MARKETING.READ', name: 'Leer marketing', group: 'PRESENCE' },
  { code: 'MARKETING.MANAGE', name: 'Gestionar marketing', group: 'PRESENCE' },
  { code: 'PROMOTIONS.MANAGE', name: 'Gestionar promociones', group: 'PRESENCE' },

  // Finanzas
  { code: 'EXPENSES.READ', name: 'Leer gastos', group: 'FINANCE' },
  { code: 'EXPENSES.MANAGE', name: 'Gestionar gastos', group: 'FINANCE' },
  { code: 'INVOICING.READ', name: 'Leer facturación', group: 'FINANCE' },
  { code: 'INVOICING.MANAGE', name: 'Gestionar facturación', group: 'FINANCE' },
  { code: 'REPORTS.READ', name: 'Leer reportes', group: 'FINANCE' },
  { code: 'CASHFLOW.READ', name: 'Leer flujo de caja', group: 'FINANCE' },

  // Organización / RBAC / Billing (globales de tenant)
  { code: 'ORG.READ', name: 'Leer organización', group: 'ORG' },
  { code: 'ORG.UPDATE', name: 'Actualizar organización', group: 'ORG' },
  { code: 'BRANCHES.READ', name: 'Leer sucursales', group: 'ORG' },
  { code: 'BRANCHES.MANAGE', name: 'Gestionar sucursales', group: 'ORG' },
  { code: 'MEMBERS.READ', name: 'Leer miembros', group: 'MEMBERS' },
  { code: 'MEMBERS.MANAGE', name: 'Gestionar miembros', group: 'MEMBERS' },
  { code: 'ROLES.READ', name: 'Leer roles', group: 'MEMBERS' },
  { code: 'ROLES.MANAGE', name: 'Gestionar roles y permisos', group: 'MEMBERS' },
  { code: 'INVITATIONS.MANAGE', name: 'Gestionar invitaciones', group: 'MEMBERS' },
  { code: 'BILLING.READ', name: 'Leer facturación', group: 'BILLING' },
  { code: 'BILLING.MANAGE', name: 'Gestionar suscripción y pagos', group: 'BILLING' },
  { code: 'SETTINGS.MANAGE', name: 'Gestionar configuración del tenant', group: 'ORG' },
];

async function main() {
  // 🌱 Planes
  console.log('🌱 Sembrando planes...');
  let createdPlans = 0;
  for (const p of PLANS) {
    const existing = await prisma.plan.findUnique({ where: { slug: p.slug } });
    if (existing) continue;
    await prisma.plan.create({ data: p });
    createdPlans++;
  }
  console.log(`  Planes: ${createdPlans} creados, ${PLANS.length - createdPlans} ya existían.`);

  // 🌱 Permisos (catálogo global; upsert idempotente por code)
  console.log('🌱 Sembrando catálogo de permisos...');
  let createdPermissions = 0;
  for (const perm of PERMISSIONS) {
    const existing = await prisma.permission.findUnique({ where: { code: perm.code } });
    if (existing) continue;
    await prisma.permission.create({
      data: { code: perm.code, name: perm.name, group: perm.group, scope: perm.scope ?? 'ORG' },
    });
    createdPermissions++;
  }
  console.log(`  Permisos: ${createdPermissions} creados, ${PERMISSIONS.length - createdPermissions} ya existían.`);

  console.log('\n✅ Seed completado (idempotente).');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});