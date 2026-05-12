import { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../AppContext';
import { 
  Home, 
  Map as MapIcon, 
  User, 
  ChevronLeft,
  Sprout,
  Menu,
  Bell,
  Search
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';

interface LayoutProps {
  children: ReactNode;
  showBack?: boolean;
  title?: string;
  hideNav?: boolean;
  hideLangToggle?: boolean;
}

export default function Layout({ children, showBack, title, hideNav, hideLangToggle }: LayoutProps) {
  const { language, setLanguage, t } = useApp();
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { icon: Home, label: t('home'), path: '/dashboard' },
    { icon: MapIcon, label: t('fields'), path: '/fields' },
    { icon: Sprout, label: 'Crops', path: '/my-crops' },
    { icon: User, label: t('profile'), path: '/profile' },
  ];

  return (
    <div className="min-h-screen flex flex-col max-w-md mx-auto bg-surface relative overflow-x-hidden">
      {/* Top Bar */}
      <header className="fixed top-0 w-full max-w-md z-50 bg-surface/80 backdrop-blur-md px-6 py-4 flex items-center justify-between border-b border-outline-variant/5">
        <div className="flex items-center gap-4">
          {showBack ? (
            <button 
              onClick={() => navigate(-1)}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-surface-container-high/50 hover:bg-surface-container-high transition-colors"
            >
              <ChevronLeft className="w-6 h-6 text-on-surface" />
            </button>
          ) : (
            <button className="p-1">
              <Menu className="w-6 h-6 text-on-surface" />
            </button>
          )}
          <h1 className="font-sans font-bold text-on-surface tracking-tight text-xl">
            {title || 'Agronomist'}
          </h1>
        </div>
        
        <div className="flex items-center gap-3">
          {!hideLangToggle && (
            <button 
              onClick={() => setLanguage(language === 'en' ? 'bn' : 'en')}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-container-high/30 font-bold text-[10px] text-on-surface-variant hover:bg-primary/10 transition-all"
            >
              {language === 'en' ? 'BN' : 'EN'}
            </button>
          )}
          <button className="p-1 opacity-20">
            <Search className="w-5 h-5 text-on-surface" />
          </button>
          <button className="p-1 opacity-20">
            <Bell className="w-5 h-5 text-on-surface" />
          </button>
        </div>
      </header>

      <main className={cn("flex-grow pt-20", !hideNav && "pb-32")}>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
        >
          {children}
        </motion.div>
      </main>

      {/* Bottom Nav */}
      {!hideNav && (
        <nav className="fixed bottom-0 w-full max-w-md z-50 bg-surface/95 backdrop-blur-lg border-t border-outline-variant/10 flex justify-around items-center py-4 px-4 shadow-[0_-4px_24px_rgba(0,0,0,0.02)]">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className="flex flex-col items-center justify-center gap-1 min-w-[70px] relative"
              >
                <div className={cn(
                  "w-16 h-8 flex items-center justify-center rounded-full transition-all duration-300",
                  isActive ? "bg-primary/20" : "bg-transparent"
                )}>
                  <Icon className={cn(
                    "w-6 h-6 transition-colors duration-300",
                    isActive ? "text-primary fill-primary/10" : "text-on-surface/60"
                  )} />
                </div>
                <span className={cn(
                  "font-sans font-bold text-[11px] transition-colors duration-300",
                  isActive ? "text-on-surface" : "text-on-surface/60"
                )}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
