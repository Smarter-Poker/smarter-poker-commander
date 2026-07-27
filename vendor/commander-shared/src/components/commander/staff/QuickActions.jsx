/**
 * QuickActions Component - Common staff actions
 * Reference: IMPLEMENTATION_PHASES.md - Step 1.5
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { Plus, UserPlus, Users, Table2, Bell, Settings, Contact, ScanLine } from 'lucide-react';

export default function QuickActions({
  onOpenGame,
  onAddWalkIn,
  onViewWaitlist,
  onManageTables,
  onSendAnnouncement,
  onSettings,
  onNewMember,
  onScanMember,
  permissions = {}
}) {
  const actions = [
    {
      id: 'open-game',
      label: 'Open Game',
      icon: Plus,
      onClick: onOpenGame,
      color: 'bg-[#22D3EE]',
      show: permissions.manage_games !== false
    },
    {
      id: 'add-walkin',
      label: 'Add Walk-In',
      icon: UserPlus,
      onClick: onAddWalkIn,
      color: 'bg-[#10B981]',
      show: permissions.manage_waitlist !== false
    },
    {
      id: 'view-waitlist',
      label: 'Full Waitlist',
      icon: Users,
      onClick: onViewWaitlist,
      color: 'bg-[#6B7280]',
      show: true
    },
    {
      id: 'manage-tables',
      label: 'Tables',
      icon: Table2,
      onClick: onManageTables,
      color: 'bg-[#6B7280]',
      show: permissions.manage_games !== false
    },
    {
      id: 'announcement',
      label: 'Announce',
      icon: Bell,
      onClick: onSendAnnouncement,
      color: 'bg-[#F59E0B]',
      show: permissions.send_notifications !== false
    },
    {
      id: 'new-member',
      label: 'New Member',
      icon: Contact,
      onClick: onNewMember,
      color: 'bg-[#8B5CF6]',
      show: true
    },
    {
      id: 'scan-card',
      label: 'Scan Card',
      icon: ScanLine,
      onClick: onScanMember,
      color: 'bg-[#0EA5E9]',
      show: true
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      onClick: onSettings,
      color: 'bg-[#6B7280]',
      show: permissions.manage_settings !== false
    }
  ].filter(action => action.show && action.onClick);

  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
      {actions.map((action) => (
        <button
          key={action.id}
          onClick={action.onClick}
          className="flex flex-col items-center gap-2 p-4 cmd-panel hover:border-[#22D3EE] hover:shadow-md transition-all min-h-[80px]"
        >
          <div className={`p-2 rounded-lg ${action.color} text-white`}>
            <action.icon className="w-5 h-5" />
          </div>
          <span className="text-sm font-medium text-white text-center">
            {action.label}
          </span>
        </button>
      ))}
    </div>
  );
}
