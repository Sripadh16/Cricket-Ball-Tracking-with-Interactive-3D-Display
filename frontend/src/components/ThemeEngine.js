import React, { createContext, useContext, useState, useMemo } from 'react';

/**
 * 4 Visual Themes for Cricket DRS & Hawk-Eye 3D Display
 * 1. cyberpunk: Dark neon stadium, glowing grid turf lines, neon cyan/magenta laser trajectories, dark space sky.
 * 2. broadcast: Classic lush green grass pitch, realistic stadium lighting, white crease lines, clear sky.
 * 3. golden: Golden hour sunset lighting, warm orange/amber turf tones, golden glowing aura.
 * 4. thermal: Infrared HotSpot thermal vision shader view (dark false-color pitch, glowing heat signature on pad/bat/ball, heat ripples).
 */
export const THEME_CONFIGS = {
  broadcast: {
    id: 'broadcast',
    name: 'Broadcast',
    label: 'Classic Broadcast',
    description: 'Classic lush green grass pitch, realistic stadium lighting, white crease lines, clear sky.',
    background: '#08121e',
    fog: {
      color: '#08121e',
      near: 35,
      far: 85
    },
    pitch: {
      outfieldColor: '#1b4332',
      pitchColor: '#d4a373',
      creaseColor: '#ffffff',
      gridColor: '#40916c',
      gridOpacity: 0.0,
      showGrid: false,
      boundaryColor: '#ffffff'
    },
    stumps: {
      color: '#d4a373',
      bailsColor: '#faedcd',
      emissive: '#000000',
      emissiveIntensity: 0.0
    },
    pads: {
      baseColor: '#f8fafc',
      ribColor: '#f8fafc',
      kneeColor: '#f1f5f9',
      emissive: '#000000',
      emissiveIntensity: 0.0,
      impactColor: '#f72585',
      impactEmissive: '#f72585',
      impactIntensity: 0.85
    },
    ball: {
      color: '#c1121f',
      seamColor: '#ffffff',
      glowColor: '#ff4d6d',
      glowIntensity: 0.25
    },
    trajectory: {
      preBounce: '#00e5ff',
      preBounceEmissive: '#00b4d8',
      postBounce: '#ffb703',
      postBounceEmissive: '#fb8500',
      extrapolated: '#f72585',
      extrapolatedEmissive: '#b5179e'
    },
    lighting: {
      ambient: '#ffffff',
      ambientIntensity: 0.6,
      keyColor: '#ffffff',
      keyIntensity: 1.3,
      fillColor: '#cbd5e1',
      fillIntensity: 0.45,
      rimColor: '#94a3b8',
      rimIntensity: 0.3
    },
    particles: {
      dustColor: '#e9c46a',
      tailColor: '#ffffff',
      burstCount: 30,
      size: 0.03
    },
    ui: {
      accent: '#e63946',
      chipBg: 'rgba(230, 57, 70, 0.9)',
      panelBg: 'rgba(10, 22, 40, 0.88)',
      borderColor: 'rgba(255, 255, 255, 0.15)'
    }
  },

  cyberpunk: {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    label: 'Cyberpunk Neon',
    description: 'Dark neon stadium, glowing grid turf lines, neon cyan/magenta laser trajectories, dark space sky.',
    background: '#04040c',
    fog: {
      color: '#050515',
      near: 25,
      far: 80
    },
    pitch: {
      outfieldColor: '#090a1a',
      pitchColor: '#0e1026',
      creaseColor: '#00f0ff',
      gridColor: '#ff007f',
      gridOpacity: 0.45,
      showGrid: true,
      boundaryColor: '#00f0ff'
    },
    stumps: {
      color: '#00f5d4',
      bailsColor: '#fee440',
      emissive: '#00f5d4',
      emissiveIntensity: 0.5
    },
    pads: {
      baseColor: '#12132e',
      ribColor: '#00f0ff',
      kneeColor: '#f72585',
      emissive: '#00f0ff',
      emissiveIntensity: 0.4,
      impactColor: '#ff0055',
      impactEmissive: '#ff0055',
      impactIntensity: 1.6
    },
    ball: {
      color: '#ff0055',
      seamColor: '#00ffff',
      glowColor: '#ff007f',
      glowIntensity: 0.85
    },
    trajectory: {
      preBounce: '#00f5ff',
      preBounceEmissive: '#00b4d8',
      postBounce: '#ff007f',
      postBounceEmissive: '#b5179e',
      extrapolated: '#ffe600',
      extrapolatedEmissive: '#ffd000'
    },
    lighting: {
      ambient: '#181135',
      ambientIntensity: 0.6,
      keyColor: '#00e5ff',
      keyIntensity: 1.4,
      fillColor: '#f72585',
      fillIntensity: 0.9,
      rimColor: '#7928ca',
      rimIntensity: 0.8
    },
    particles: {
      dustColor: '#ff007f',
      tailColor: '#00f5ff',
      burstCount: 45,
      size: 0.04
    },
    ui: {
      accent: '#00f0ff',
      chipBg: 'rgba(255, 0, 127, 0.85)',
      panelBg: 'rgba(9, 10, 26, 0.92)',
      borderColor: 'rgba(0, 240, 255, 0.4)'
    }
  },

  golden: {
    id: 'golden',
    name: 'Golden',
    label: 'Golden Hour',
    description: 'Golden hour sunset lighting, warm orange/amber turf tones, golden glowing aura.',
    background: '#1c0f0a',
    fog: {
      color: '#2b140b',
      near: 30,
      far: 80
    },
    pitch: {
      outfieldColor: '#283618',
      pitchColor: '#dda15e',
      creaseColor: '#fefae0',
      gridColor: '#bc6c25',
      gridOpacity: 0.15,
      showGrid: false,
      boundaryColor: '#fefae0'
    },
    stumps: {
      color: '#bc6c25',
      bailsColor: '#fefae0',
      emissive: '#d4a373',
      emissiveIntensity: 0.2
    },
    pads: {
      baseColor: '#fefae0',
      ribColor: '#faedcd',
      kneeColor: '#e9d8a6',
      emissive: '#d4a373',
      emissiveIntensity: 0.15,
      impactColor: '#e63946',
      impactEmissive: '#e63946',
      impactIntensity: 0.95
    },
    ball: {
      color: '#9e2a2b',
      seamColor: '#fff1e6',
      glowColor: '#ffb703',
      glowIntensity: 0.7
    },
    trajectory: {
      preBounce: '#ffb703',
      preBounceEmissive: '#fb8500',
      postBounce: '#fb5607',
      postBounceEmissive: '#e85d04',
      extrapolated: '#ff006e',
      extrapolatedEmissive: '#d00000'
    },
    lighting: {
      ambient: '#ffb703',
      ambientIntensity: 0.5,
      keyColor: '#ff9e00',
      keyIntensity: 1.6,
      fillColor: '#e85d04',
      fillIntensity: 0.75,
      rimColor: '#ffd166',
      rimIntensity: 0.9
    },
    particles: {
      dustColor: '#ffb703',
      tailColor: '#ffd166',
      burstCount: 35,
      size: 0.035
    },
    ui: {
      accent: '#ffb703',
      chipBg: 'linear-gradient(135deg, #d97706, #b45309)',
      panelBg: 'rgba(28, 15, 10, 0.92)',
      borderColor: 'rgba(251, 191, 36, 0.4)'
    }
  },

  thermal: {
    id: 'thermal',
    name: 'Thermal',
    label: 'Infrared HotSpot',
    description: 'Infrared HotSpot thermal vision shader view (dark false-color pitch, glowing heat signature on pad/bat/ball, heat ripples).',
    background: '#020208',
    fog: {
      color: '#040412',
      near: 20,
      far: 70
    },
    pitch: {
      outfieldColor: '#050814',
      pitchColor: '#0a1024',
      creaseColor: '#1e3a8a',
      gridColor: '#00f5d4',
      gridOpacity: 0.35,
      showGrid: true,
      boundaryColor: '#0077b6'
    },
    stumps: {
      color: '#1a237e',
      bailsColor: '#283593',
      emissive: '#3d5afe',
      emissiveIntensity: 0.6
    },
    pads: {
      baseColor: '#0a1128',
      ribColor: '#12264f',
      kneeColor: '#1e3a8a',
      emissive: '#1d4ed8',
      emissiveIntensity: 0.5,
      impactColor: '#ffffff',
      impactEmissive: '#ffffff',
      impactIntensity: 2.2
    },
    ball: {
      color: '#ffffff',
      seamColor: '#ffee55',
      glowColor: '#ff2200',
      glowIntensity: 1.6
    },
    trajectory: {
      preBounce: '#00b4d8',
      preBounceEmissive: '#00f5d4',
      postBounce: '#f72585',
      postBounceEmissive: '#ffbe0b',
      extrapolated: '#ffffff',
      extrapolatedEmissive: '#ff0055'
    },
    lighting: {
      ambient: '#03071e',
      ambientIntensity: 0.55,
      keyColor: '#0077b6',
      keyIntensity: 1.2,
      fillColor: '#7209b7',
      fillIntensity: 0.8,
      rimColor: '#4cc9f0',
      rimIntensity: 1.0
    },
    particles: {
      dustColor: '#ff0055',
      tailColor: '#ffee55',
      burstCount: 50,
      size: 0.045
    },
    ui: {
      accent: '#ff0055',
      chipBg: 'linear-gradient(135deg, #3a0ca3, #ff0055)',
      panelBg: 'rgba(4, 6, 20, 0.95)',
      borderColor: 'rgba(255, 0, 85, 0.5)'
    }
  }
};

/**
 * Returns theme configuration object by name, fallback to 'broadcast'
 */
export function getThemeColors(themeName) {
  if (themeName && THEME_CONFIGS[themeName]) {
    return THEME_CONFIGS[themeName];
  }
  return THEME_CONFIGS.broadcast;
}

// React Context for Global or Scoped Theme Control
export const ThemeContext = createContext({
  themeName: 'broadcast',
  theme: THEME_CONFIGS.broadcast,
  setThemeName: () => {},
  allThemes: Object.values(THEME_CONFIGS)
});

export function ThemeProvider({ children, defaultTheme = 'broadcast' }) {
  const [themeName, setThemeName] = useState(defaultTheme);

  const value = useMemo(() => {
    const theme = getThemeColors(themeName);
    return {
      themeName,
      theme,
      setThemeName,
      allThemes: Object.values(THEME_CONFIGS)
    };
  }, [themeName]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Hook to access active theme and theme changer
 */
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    return {
      themeName: 'broadcast',
      theme: THEME_CONFIGS.broadcast,
      setThemeName: () => {},
      allThemes: Object.values(THEME_CONFIGS)
    };
  }
  return context;
}

const ThemeEngine = {
  THEME_CONFIGS,
  getThemeColors,
  ThemeContext,
  ThemeProvider,
  useTheme
};

export default ThemeEngine;
