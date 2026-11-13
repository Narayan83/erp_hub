import { ActionSelectMaster } from '../masters/ActionSelectMaster'

export function RoleManagementPage() {
  return (
    <ActionSelectMaster
      title="Role Creation"
      listPath="/hospital/roles"
      codeKey="role_name"
      labelKey="role_name"
      defaults={{ role_name: '', description: '' }}
      fields={[
        { key: 'role_name', label: 'Role Name', required: true },
        { key: 'description', label: 'Description' },
      ]}
      columns={[
        { key: 'role_name', label: 'Role' },
        { key: 'description', label: 'Description' },
        { key: 'is_active', label: 'Active' },
      ]}
      mapCreate={(form) => ({
        role_name: form.role_name,
        description: form.description || null,
      })}
      mapUpdate={(form) => ({
        role_name: form.role_name,
        description: form.description || null,
      })}
    />
  )
}
