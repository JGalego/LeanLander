import { invoke, isTauri } from '@tauri-apps/api/core'

export type DoctorStatus = 'ok' | 'warning' | 'error' | 'unavailable'

export interface DoctorRepair {
  id: string
  label: string
  description: string
  canRun: boolean
}

export interface DoctorCheck {
  id: string
  label: string
  status: DoctorStatus
  summary: string
  repair: DoctorRepair | null
}

export interface DoctorReport {
  status: DoctorStatus
  checks: DoctorCheck[]
}

export interface DoctorLogSection {
  label: string
  content: string
}

export interface DoctorLogs {
  sections: DoctorLogSection[]
}

export interface DoctorClient {
  diagnose(
    projectPath: string | null,
    requiredToolchain: string | null,
  ): Promise<DoctorReport>
  logs(
    projectPath: string | null,
    requiredToolchain: string | null,
  ): Promise<DoctorLogs>
}

export const browserDoctorReport: DoctorReport = {
  status: 'unavailable',
  checks: [
    {
      id: 'native',
      label: 'Desktop diagnostics',
      status: 'unavailable',
      summary: 'Lean Doctor requires the desktop application.',
      repair: null,
    },
  ],
}

export const doctorClient: DoctorClient = {
  diagnose(projectPath, requiredToolchain) {
    return isTauri()
      ? invoke<DoctorReport>('diagnose_environment', { projectPath, requiredToolchain })
      : Promise.resolve(browserDoctorReport)
  },

  logs(projectPath, requiredToolchain) {
    return isTauri()
      ? invoke<DoctorLogs>('doctor_logs', { projectPath, requiredToolchain })
      : Promise.resolve({
          sections: [{
            label: 'Environment',
            content: 'Native diagnostic logs require the desktop application.',
          }],
        })
  },
}