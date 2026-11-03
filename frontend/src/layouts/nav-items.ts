import {
  Bell,
  BookHeart,
  Compass,
  Home,
  MessagesSquare,
  ScanSearch,
  Settings as SettingsIcon,
  UserRound,
  Users,
  UsersRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end: boolean;
  badge?: number;
}

/** Main app destinations, shared by the sidebar and mobile drawer. */
export const MAIN_NAV: NavItem[] = [
  { to: '/app', label: 'Home', icon: Home, end: true },
  { to: '/app/discover', label: 'Discover', icon: Compass, end: false },
  {
    to: '/app/detective',
    label: 'Memory Detective',
    icon: ScanSearch,
    end: false,
  },
  { to: '/app/memories', label: 'Memories', icon: BookHeart, end: false },
  { to: '/app/connections', label: 'Connections', icon: Users, end: false },
  { to: '/app/communities', label: 'Communities', icon: UsersRound, end: false },
  { to: '/app/messages', label: 'Messages', icon: MessagesSquare, end: false },
  { to: '/app/notifications', label: 'Notifications', icon: Bell, end: false },
  { to: '/app/profile', label: 'Profile', icon: UserRound, end: false },
];

export const SETTINGS_ITEM: NavItem = {
  to: '/app/settings',
  label: 'Settings',
  icon: SettingsIcon,
  end: false,
};
