import { useEffect, useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken, hasPermission } from '../auth/auth'
import {
  canAccessPage,
  getInitialAdminPage,
} from '../auth/permissions'
import AdminSidebar from './AdminSidebar'
import Customers from './Customers'
import PasswordRecovery from './PasswordRecovery'
import SystemSettings from './SystemSettings'
import TechnicianApplications from './TechnicianApplications'
import Technicians from './Technicians'
import TechnicianDetail from './TechnicianDetail'
import KycVerification from './KycVerification'
import KycDetail from './KycDetail'
import Skills from './Skills'
import Tools from './Tools'
import ServiceCategories from './ServiceCategories'
import Services from './Services'
import ServiceSkills from './ServiceSkills'
import ServiceTools from './ServiceTools'
import TechnicianLocations from './TechnicianLocations'
import TechnicianAvailability from './TechnicianAvailability'
import AdminNotifications from './AdminNotifications'
import AdminExceptions from './AdminExceptions'
import AdminUsers from './AdminUsers'
import RolesPermissions from './RolesPermissions'
import AdminAuditLogs from './AdminAuditLogs'
import AdminDisputes from './AdminDisputes'

function StatCard({ title, value, description }) {
  return (
    <div className="stat-card">
      <div className="stat-title">{title}</div>

      <div className="stat-value">{value}</div>

      <div className="stat-description">
        {description}
      </div>
    </div>
  )
}

function Dashboard({ user, onLogout }) {
  const [activePage, setActivePage] =
    useState(() => getInitialAdminPage(user))

  const [
    selectedTechnicianId,
    setSelectedTechnicianId,
  ] = useState(null)
const [
  selectedKycTechnicianId,
  setSelectedKycTechnicianId,
] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] =
    useState(false)

  const [dashboard, setDashboard] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const canViewDashboard = hasPermission(user, 'dashboard.read')

  useEffect(() => {
    if (!canViewDashboard) {
      return
    }

    let cancelled = false

    async function loadDashboard() {
      try {
        const data = await apiRequest(
          '/admin/dashboard',
          {},
          getToken(),
        )

        if (!cancelled) {
          setDashboard(data.data)
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.message ||
              'Unable to load dashboard',
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadDashboard()

    return () => {
      cancelled = true
    }
  }, [canViewDashboard])

function handleNavigation(page) {
  if (!canAccessPage(user, page)) {
    return
  }
  setSelectedTechnicianId(null)
  setSelectedKycTechnicianId(null)
  setActivePage(page)
}
function handleReviewKyc(technicianId) {
  setSelectedKycTechnicianId(technicianId)
}

function handleBackToKyc() {
  setSelectedKycTechnicianId(null)
}
  function handleViewTechnician(technicianId) {
    setSelectedTechnicianId(technicianId)
  }

  function handleBackToTechnicians() {
    setSelectedTechnicianId(null)
  }

  function renderDashboard() {
    return (
      <main className="admin-content">
        <section className="page-heading">
          <div>
            <span className="section-label">
              MARKETPLACE OVERVIEW
            </span>

            <h2>Dashboard</h2>

            <p>
              Live operational status from the
              Vishwakarma Setu marketplace.
            </p>
          </div>
        </section>

        {loading && (
          <div className="status-panel">
            Loading dashboard...
          </div>
        )}

        {error && (
          <div className="error-panel">
            {error}
          </div>
        )}

        {dashboard && (
          <>
            <div className="stats-grid">
              <StatCard
                title="Customers"
                value={dashboard.customers.total}
                description="Registered customers"
              />

              <StatCard
                title="Technicians"
                value={dashboard.technicians.total}
                description="Registered technicians"
              />

              <StatCard
                title="Online"
                value={dashboard.technicians.online}
                description="Technicians currently online"
              />

              <StatCard
                title="Busy"
                value={dashboard.technicians.busy}
                description="Technicians with active jobs"
              />

              <StatCard
                title="Pending KYC"
                value={
                  dashboard.technicians.pending_kyc
                }
                description="Technicians requiring review"
              />

              <StatCard
                title="Open Requests"
                value={
                  dashboard.service_requests.open
                }
                description="Open customer service requests"
              />

              <StatCard
                title="Unmatched Requests"
                value={
                  dashboard.service_requests.unmatched
                }
                description="Requests needing technician assignment"
              />

              <StatCard
                title="Active Jobs"
                value={dashboard.jobs.active}
                description="Jobs currently in progress"
              />
            </div>

            <section className="operations-card">
              <div>
                <span className="section-label">
                  JOB OPERATIONS
                </span>

                <h3>Job Status</h3>
              </div>

              <div className="job-status-grid">
                <div>
                  <strong>
                    {dashboard.jobs.active}
                  </strong>

                  <span>Active</span>
                </div>

                <div>
                  <strong>
                    {dashboard.jobs.completed}
                  </strong>

                  <span>Completed</span>
                </div>

                <div>
                  <strong>
                    {dashboard.jobs.cancelled}
                  </strong>

                  <span>Cancelled</span>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    )
  }

  function renderTechnicians() {
    if (selectedTechnicianId) {
      return (
        <main className="admin-content">
          <TechnicianDetail
            technicianId={selectedTechnicianId}
            onBack={handleBackToTechnicians}
          />
        </main>
      )
    }

    return (
      <main className="admin-content">
        <Technicians
          onViewTechnician={
            handleViewTechnician
          }
        />
      </main>
    )
  }

  function renderPage() {
    if (!canAccessPage(user, activePage)) {
      return (
        <main className="admin-content">
          <div className="error-panel">
            You do not have permission to access this module.
          </div>
        </main>
      )
    }

    if (activePage === 'access') {
      return (
        <main className="admin-content">
          <section className="page-heading">
            <div>
              <h2>{user?.admin_role_name || 'Administrator Access'}</h2>
              <p>Your role has no enabled modules yet.</p>
            </div>
          </section>
        </main>
      )
    }
    if (activePage === 'disputes') {
      return (
        <main className="admin-content">
          <AdminDisputes user={user} />
        </main>
      )
    }

    if (activePage === 'audit') {
      return (
        <main className="admin-content">
          <AdminAuditLogs />
        </main>
      )
    }

    if (activePage === 'roles') {
      return (
        <main className="admin-content">
          <RolesPermissions user={user} />
        </main>
      )
    }

    if (activePage === 'dashboard') {
      return renderDashboard()
    }

    if (activePage === 'technician-applications') {
      return (
        <main className="admin-content">
          <TechnicianApplications
            user={user}
            onReviewKyc={(technicianId) => {
              setSelectedKycTechnicianId(technicianId)
              setActivePage('kyc')
            }}
          />
        </main>
      )
    }

    if (activePage === 'settings') {
      return <SystemSettings user={user} />
    }

    if (activePage === 'password-recovery') {
      return <PasswordRecovery />
    }

    if (activePage === 'customers') {
      return (
        <main className="admin-content">
          <Customers />
        </main>
      )
    }

    if (activePage === 'technicians') {
      return renderTechnicians()
    }

    if (activePage === 'kyc') {
      if (selectedKycTechnicianId) {
        return (
          <main className="admin-content">
            <KycDetail
              technicianId={
                selectedKycTechnicianId
              }
              onBack={handleBackToKyc}
            />
          </main>
        )
      }

      return (
        <main className="admin-content">
          <KycVerification
            onReview={handleReviewKyc}
          />
        </main>
      )
    }

    if (activePage === 'skills') {
      return (
        <main className="admin-content">
          <Skills />
        </main>
      )
    }
if (activePage === 'tools') {
  return (
    <main className="admin-content">
      <Tools />
    </main>
  )
}
if (activePage === 'categories') {
  return (
    <main className="admin-content">
      <ServiceCategories />
    </main>
  )
}   
if (activePage === 'services') {
  return (
    <main className="admin-content">
      <Services />
    </main>
  )
}
if (activePage === 'service-skills') {
  return (
    <ServiceSkills />
  )
}
if (activePage === 'service-tools') {
  return (
    <ServiceTools />
  )
}
if (activePage === 'locations') {
  return (
    <TechnicianLocations />
  )
}
if (activePage === 'availability') {
  return (
    <TechnicianAvailability />
  )
}
if (activePage === 'notifications') {
  return (
    <AdminNotifications />
  )
}
if (activePage === 'exceptions') {
  return (
    <AdminExceptions />
  )
}
if (activePage === 'admins') {
  return <AdminUsers user={user} />
}
return (
      <main className="admin-content">
        <div className="module-development-banner">
          <strong>
            {activePage
              .replaceAll('-', ' ')
              .toUpperCase()}
          </strong>

          <span>
            This administration module will be
            connected in the next development phase.
          </span>
        </div>
      </main>
    )
  }

  return (
    <div className="admin-shell">
      <AdminSidebar
        user={user}
        activePage={activePage}
        onNavigate={handleNavigation}
        collapsed={sidebarCollapsed}
        onToggle={() =>
          setSidebarCollapsed(
            (value) => !value,
          )
        }
      />

      <div className="admin-main">
        <div className="admin-dashboard">
          <header className="admin-header">
            <div>
              <div className="brand-name">
                VISHWAKARMA SETU
              </div>

              <h1>Admin Control Center</h1>

              <p>
                Marketplace operations and
                administration
              </p>
            </div>

            <div className="admin-header-actions">
              <div className="admin-identity">
                <strong>
                  {user?.full_name ||
                    'Administrator'}
                </strong>

                <span>{user?.admin_role_name || 'ADMIN'}</span>
              </div>

              <button
                type="button"
                className="logout-button"
                onClick={onLogout}
              >
                Logout
              </button>
            </div>
          </header>

          {renderPage()}
        </div>
      </div>
    </div>
  )
}

export default Dashboard