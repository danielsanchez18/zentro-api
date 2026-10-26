/**
 * Perfiles de acceso de sistema (los mismos del módulo Equipo del workspace).
 * Se crean por organización la primera vez que se invita; el Owner no está
 * aquí porque nunca es asignable. Los permisos usan el catálogo `Permission`.
 */
export interface RoleTemplate {
  name: string;
  description: string;
  permissionCodes: string[];
}

/** Rol por defecto si la invitación no indica uno (el de menor alcance operativo). */
export const DEFAULT_ROLE = 'Vendedor';

const BASE = ['ORG.READ', 'BRANCHES.READ'];

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    name: 'Administrador',
    description:
      'Gestiona el equipo, la configuración y la operación del negocio.',
    // Todo excepto pagar la suscripción (exclusivo del Owner).
    permissionCodes: ['*', '!BILLING.MANAGE'],
  },
  {
    name: 'Vendedor',
    description: 'Realiza ventas, atiende pedidos y gestiona clientes.',
    permissionCodes: [
      ...BASE,
      'SALES.READ',
      'SALES.CREATE',
      'ORDERS.READ',
      'ORDERS.CREATE',
      'ORDERS.UPDATE',
      'PAYMENTS.READ',
      'PAYMENTS.PROCESS',
      'CLIENTS.READ',
      'CLIENTS.CREATE',
      'CLIENTS.UPDATE',
      'CRM.READ',
      'CRM.CREATE',
      'CRM.UPDATE',
      'APPOINTMENTS.READ',
      'PRODUCTS.READ',
      'CATEGORIES.READ',
    ],
  },
  {
    name: 'Cajero',
    description: 'Opera el punto de venta y la caja del día.',
    permissionCodes: [
      ...BASE,
      'CASH.READ',
      'CASH.MANAGE',
      'SALES.READ',
      'SALES.CREATE',
      'PAYMENTS.READ',
      'PAYMENTS.PROCESS',
      'ORDERS.READ',
      'PRODUCTS.READ',
      'CLIENTS.READ',
    ],
  },
  {
    name: 'Contador',
    description: 'Accede a reportes, finanzas y comprobantes.',
    permissionCodes: [
      ...BASE,
      'REPORTS.READ',
      'CASHFLOW.READ',
      'EXPENSES.READ',
      'EXPENSES.MANAGE',
      'INVOICING.READ',
      'INVOICING.MANAGE',
      'SALES.READ',
      'PAYMENTS.READ',
      'CASH.READ',
      'PURCHASES.READ',
      'BILLING.READ',
      'AUDIT.READ',
    ],
  },
  {
    name: 'Inventario y compras',
    description: 'Administra stock, compras y recepciones.',
    permissionCodes: [
      ...BASE,
      'INVENTORY.READ',
      'INVENTORY.UPDATE',
      'PURCHASES.READ',
      'PURCHASES.CREATE',
      'SUPPLIERS.READ',
      'SUPPLIERS.MANAGE',
      'TRANSFERS.MANAGE',
      'PRODUCTS.READ',
      'PRODUCTS.CREATE',
      'PRODUCTS.UPDATE',
      'CATEGORIES.READ',
      'CATEGORIES.MANAGE',
    ],
  },
  {
    name: 'Contenido y canales',
    description: 'Administra sitio web, blog, marketing y marketplace.',
    permissionCodes: [
      ...BASE,
      'WEB.READ',
      'WEB.EDIT',
      'BLOG.READ',
      'BLOG.MANAGE',
      'MARKETING.READ',
      'MARKETING.MANAGE',
      'PROMOTIONS.MANAGE',
      'PRODUCTS.READ',
      'CATEGORIES.READ',
    ],
  },
];

/** Expande "*" (todos) y "!CODE" (excepto) contra el catálogo real. */
export const resolveCodes = (template: RoleTemplate, catalog: string[]) => {
  const excluded = new Set(
    template.permissionCodes
      .filter((code) => code.startsWith('!'))
      .map((code) => code.slice(1)),
  );
  const base = template.permissionCodes.includes('*')
    ? catalog
    : template.permissionCodes.filter((code) => !code.startsWith('!'));
  const known = new Set(catalog);
  return [...new Set(base)].filter(
    (code) => known.has(code) && !excluded.has(code),
  );
};
