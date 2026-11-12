import React from 'react';

export default function PitchDiagram() {
  return (
    <svg className="pitch-diagram" viewBox="0 0 540 330" role="img" aria-labelledby="pitch-diagram-title">
      <title id="pitch-diagram-title">Illustration of a cricket delivery bouncing toward the wicket</title>
      <defs><pattern id="pitch-grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" fill="none" stroke="currentColor" strokeWidth=".5" opacity=".18" /></pattern></defs>
      <rect width="540" height="330" fill="url(#pitch-grid)" />
      <g fill="none" stroke="#647269" strokeWidth="1">
        <path d="M95 263 281 74 459 134 275 322Z" fill="#1b2924" />
        <path d="m142 258 151-155 116 39-151 155Z" fill="#344039" />
        <path d="m163 238 116 39M273 126l116 39" stroke="#a3ada5" />
        <path d="m153 248 116 39M283 116l116 39" opacity=".5" />
      </g>
      <path d="M141 129Q217 24 288 200" fill="none" stroke="#c1dc87" strokeWidth="3" />
      <path d="M288 200Q318 150 362 150" fill="none" stroke="#e0b779" strokeWidth="3" />
      <path d="m362 150 31 8" fill="none" stroke="#c2cac4" strokeWidth="2" strokeDasharray="5 5" />
      <ellipse cx="288" cy="202" rx="12" ry="5" fill="#c1dc8722" stroke="#c1dc87" />
      <circle cx="333" cy="156" r="6" fill="#dc775f" stroke="#f2b19d" strokeWidth="1.5" />
      <g stroke="#e9ede7" strokeWidth="3" strokeLinecap="round">
        <path d="M386 164v-32m7 35v-32m7 35v-32m-15-7 17 6" />
        <path d="M189 282v-27m7 29v-27m7 29v-27m-15-6 17 5" opacity=".65" />
      </g>
      <g fontFamily="monospace" fontSize="10" fill="#a5b1a8">
        <path d="m288 202-33 40h-47M335 156l22-57h66" fill="none" stroke="#748476" strokeWidth=".7" />
        <text x="178" y="257">01 / BOUNCE</text><text x="360" y="90">02 / FLIGHT</text>
        <text x="30" y="34" letterSpacing="2">DELIVERY GEOMETRY</text>
        <text x="30" y="305" fill="#c1dc87">ILLUSTRATION · NOT TRACKED DATA</text>
      </g>
    </svg>
  );
}
