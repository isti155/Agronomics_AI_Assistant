import { useState, useEffect, useCallback } from 'react';
import { CloudRain, Wind, Droplets, ChevronRight, Eye, RotateCcw } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';

export default function Weather() {
  const [weatherData, setWeatherData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const navigate = useNavigate();

  const fetchWeather = useCallback((showRefreshSpinner = false) => {
    if (showRefreshSpinner) setRefreshing(true);
    else setLoading(true);
    setError(null);

    const apiKey = import.meta.env.VITE_WEATHER_API_KEY;

    const fetchByUrl = async (url: string) => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch weather data');
        const data = await response.json();
        setWeatherData(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    };

    const fetchByIpFallback = async () => {
      try {
        const geoRes = await fetch('https://get.geojs.io/v1/ip/geo.json');
        if (!geoRes.ok) throw new Error('IP Geo failed');
        const geoData = await geoRes.json();
        fetchByUrl(`https://api.openweathermap.org/data/2.5/weather?lat=${geoData.latitude}&lon=${geoData.longitude}&units=metric&appid=${apiKey}`);
      } catch {
        fetchByUrl(`https://api.openweathermap.org/data/2.5/weather?q=Dhaka,BD&units=metric&appid=${apiKey}`);
      }
    };

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) =>
          fetchByUrl(`https://api.openweathermap.org/data/2.5/weather?lat=${coords.latitude}&lon=${coords.longitude}&units=metric&appid=${apiKey}`),
        () => fetchByIpFallback(),
        { timeout: 10000, enableHighAccuracy: true }
      );
    } else {
      fetchByIpFallback();
    }
  }, []);

  useEffect(() => {
    fetchWeather();
  }, [fetchWeather]);

  if (loading) {
    return (
      <div className="rounded-[2rem] min-h-[180px] flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #1a4a2e 0%, #2d7a4e 50%, #1e6b45 100%)' }}>
        <div className="w-8 h-8 border-4 border-white/60 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !weatherData) {
    return (
      <div className="rounded-[2rem] min-h-[180px] flex flex-col items-center justify-center gap-2 p-8" style={{ background: 'linear-gradient(135deg, #1a4a2e 0%, #2d7a4e 50%, #1e6b45 100%)' }}>
        <CloudRain className="w-8 h-8 text-white/60" />
        <p className="font-medium text-sm text-white/80">Could not load weather data.</p>
        <p className="text-xs text-white/50">{error}</p>
      </div>
    );
  }

  const temp = Math.round(weatherData.main.temp);
  const feelsLike = Math.round(weatherData.main.feels_like);
  const humidity = weatherData.main.humidity;
  const description = weatherData.weather[0]?.description || 'Clear';
  const mainCondition = weatherData.weather[0]?.main || 'Clear';
  const city = weatherData.name;
  const lat = weatherData.coord?.lat?.toFixed(2) || '23.54';

  const getWeatherIcon = (condition: string) => {
    const c = condition.toLowerCase();
    if (c.includes('thunder')) return '⛈️';
    if (c.includes('rain') || c.includes('drizzle')) return '🌧️';
    if (c.includes('snow')) return '❄️';
    if (c.includes('cloud')) return '⛅';
    return '☀️';
  };

  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      onClick={() => navigate('/weather')}
      className="rounded-[2.5rem] p-6 cursor-pointer relative overflow-hidden shadow-sm bg-[#1e5d2d] text-white"
    >
      <div className="relative z-10 space-y-6">
        {/* Top Row: Location */}
        <div className="flex items-center gap-1 opacity-80">
          <p className="text-[10px] font-black uppercase tracking-[0.2em]">
            {city} - {lat}°N
          </p>
        </div>

        {/* Middle Row: Temp + Icon */}
        <div className="flex justify-between items-center">
          <div className="space-y-1">
            <div className="flex items-start">
              <span className="text-7xl font-sans font-black leading-none">{temp}</span>
              <span className="text-3xl font-medium mt-1">°C</span>
            </div>
            <p className="text-base font-medium opacity-90 capitalize">{description}</p>
          </div>
          <div className="text-6xl drop-shadow-lg">
            {getWeatherIcon(mainCondition)}
          </div>
        </div>

        {/* Bottom Row: Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'FEELS', value: `${feelsLike}°` },
            { label: 'HUMIDITY', value: `${humidity}%` },
            { label: 'RAIN', value: `20%` }, // Placeholder for rain chance as OWM current doesn't always provide it
          ].map((stat) => (
            <div key={stat.label} className="bg-white/10 rounded-2xl p-3 backdrop-blur-md">
              <p className="text-[9px] font-black uppercase tracking-widest opacity-60 mb-1">{stat.label}</p>
              <p className="text-lg font-black">{stat.value}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
