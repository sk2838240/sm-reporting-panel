// Maps the icon NAMES used in SERVICE_META to real lucide components.
//
// SERVICE_META.icon is a string, not a component. Rendering <m.icon /> therefore
// produced React.createElement('Search'), which React treats as an unknown host
// tag named "search" — an empty element plus a console warning on every render.
// Five call sites (service tabs, card headers, empty states, the editor header)
// were showing text with a blank gap where the icon should be.
//
// Kept in its own module so constants.js stays a plain data file with no JSX
// and no component imports.
import { createElement } from 'react';
import { Search, ShieldCheck, Share2, BarChart3, LineChart, Megaphone, Globe, Eye, MousePointerClick, FileText, Users, Settings, Activity, Target, Layers, Scale } from 'lucide-react';

export const SERVICE_ICONS = {
  Search,
  ShieldCheck,
  Share2,
  // Extra names referenced from metric/table definitions elsewhere.
  BarChart3,
  LineChart,
  Megaphone,
  Globe,
  Eye,
  MousePointerClick,
  FileText,
  Users,
  Settings,
  Activity,
  Target,
  Layers,
  Scale,
};

// Resolves a name from SERVICE_META (or anywhere else) to a component, falling
// back to BarChart3 rather than rendering nothing if a name is ever missing.
export function serviceIcon(name) {
  return SERVICE_ICONS[name] || BarChart3;
}

// Component form, for use directly in JSX: <ServiceIcon name={m.icon} ... />
// Uses createElement rather than a capitalised local variable: assigning a
// component to a capitalised identifier during render is treated as creating a
// new component type each pass, which would remount and lose state.
export function ServiceIcon({ name, ...props }) {
  return createElement(serviceIcon(name), props);
}
