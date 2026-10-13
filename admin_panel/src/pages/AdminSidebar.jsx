import { canAccessPage } from '../auth/permissions'

const navigationGroups = [
  {
    label: '',
    items: [
      { id: 'dashboard', icon: '▦', label: 'Dashboard' },
    ],
  },
  {
    label: 'MARKETPLACE',
    items: [
      { id: 'customers', icon: '👥', label: 'Customers' },
      { id: 'technicians', icon: '🧑‍🔧', label: 'Technicians' },
      { id: 'requests', icon: '📋', label: 'Service Requests' },
      { id: 'jobs', icon: '💼', label: 'Jobs' },
      { id: 'ratings', icon: '★', label: 'Ratings & Reviews' },
    ],
  },
  {
    label: 'TECHNICIAN MANAGEMENT',
    items: [
      { id: 'technician-applications', icon: 'A', label: 'Technician Applications' },
      { id: 'kyc', icon: '✓', label: 'KYC Verification' },
      { id: 'skills', icon: '◆', label: 'Skills' },
      { id: 'tools', icon: '🔧', label: 'Tools' },
      { id: 'locations', icon: '⌖', label: 'Technician Locations' },
    ],
  },
  {
    label: 'MASTER DATA',
    items: [
      { id: 'categories', icon: '▤', label: 'Service Categories' },
      { id: 'services', icon: '⚙', label: 'Services' },
      { id: 'service-skills', icon: '↔', label: 'Service → Skills' },
      { id: 'service-tools', icon: '↔', label: 'Service → Tools' },
    ],
  },
  {
    label: 'OPERATIONS',
    items: [
      { id: 'availability', icon: '●', label: 'Availability / Busy' },
      { id: 'notifications', icon: '🔔', label: 'Notifications' },
      { id: 'exceptions', icon: '⚠', label: 'Exceptions / Stuck Jobs' },
      { id: 'disputes', icon: '!', label: 'Work Disputes' },
    ],
  },
  {
    label: 'PLATFORM',
    items: [
      { id: 'admins', icon: '♙', label: 'Admin Users' },
      { id: 'roles', icon: '🔐', label: 'Roles & Permissions' },
      { id: 'audit', icon: '☷', label: 'Audit Logs' },
      { id: 'settings', icon: '⚙', label: 'System Settings' },
    ],
  },
]

function AdminSidebar({
  user,
  activePage,
  onNavigate,
  collapsed,
  onToggle,
}) {
  const visibleNavigationGroups = navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => canAccessPage(user, item.id),
      ),
    }))
    .filter((group) => group.items.length > 0)

  return (
    <aside
      className={`admin-sidebar ${
        collapsed ? 'collapsed' : ''
      }`}
    >
      <div className="sidebar-brand">
        <div className="sidebar-brand-row">
          <div className="sidebar-logo">♨</div>

          {!collapsed && (
            <div>
              <strong>VISHWAKARMA SETU</strong>
              <span>ADMIN CONTROL CENTER</span>
            </div>
          )}
        </div>

        <button
          type="button"
          className="sidebar-toggle"
          onClick={onToggle}
          aria-label={
            collapsed
              ? 'Expand sidebar'
              : 'Collapse sidebar'
          }
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      <nav className="sidebar-navigation">
        {visibleNavigationGroups.map((group, groupIndex) => (
          <div
            className="sidebar-group"
            key={`${group.label}-${groupIndex}`}
          >
            {!collapsed && group.label && (
              <div className="sidebar-group-label">
                {group.label}
              </div>
            )}

            {group.items.map((item) => (
              <button
                type="button"
                key={item.id}
                title={collapsed ? item.label : undefined}
                className={`sidebar-item ${
                  activePage === item.id ? 'active' : ''
                }`}
                onClick={() => onNavigate(item.id)}
              >
                <span className="sidebar-icon">
                  {item.icon}
                </span>

                {!collapsed && (
                  <span>{item.label}</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}

export default AdminSidebar