import { hasPermission } from './auth'

const pagePermissions = {
  dashboard: 'dashboard.read',
  customers: 'customers.read',
  technicians: 'technicians.read',
  'technician-applications': 'technician_applications.read',
  kyc: 'kyc.read',
  skills: 'skills.read',
  tools: 'tools.read',
  categories: 'categories.read',
  services: 'services.read',
  'service-skills': 'service_skills.read',
  'service-tools': 'service_tools.read',
  locations: 'locations.read',
  availability: 'availability.read',
  notifications: 'notifications.read',
  exceptions: 'exceptions.read',
  admins: 'admin_users.read',
  roles: 'roles.read',
  audit: 'audit.read',
  disputes: 'disputes.read',
}

export function canAccessPage(user, page) {
  if (page === 'access') {
    return true
  }

  const permission = Object.hasOwn(pagePermissions, page)
    ? pagePermissions[page]
    : null

  return Boolean(permission) && hasPermission(user, permission)
}

export function getInitialAdminPage(user) {
  return Object.keys(pagePermissions).find(
    (page) => canAccessPage(user, page),
  ) || 'access'
}