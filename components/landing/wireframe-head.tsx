// 랜딩 히어로의 와이어프레임 두상 일러스트 (FLAME 토폴로지 모티프)
export function WireframeHead({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 480" fill="none" aria-hidden className={className}>
      <defs>
        <clipPath id="wirehead-clip">
          <path d="M200,36 C276,36 318,104 318,190 C318,288 272,406 200,428 C128,406 82,288 82,190 C82,104 124,36 200,36 Z" />
        </clipPath>
      </defs>

      {/* 위도/경도 와이어 그리드 */}
      <g
        className="wire-grid-fade stroke-clay-500"
        clipPath="url(#wirehead-clip)"
        strokeWidth="0.8"
        opacity="0.75"
      >
        <path d="M60,90 C140,66 260,66 340,90" />
        <path d="M60,140 C140,118 260,118 340,140" />
        <path d="M60,190 C140,172 260,172 340,190" />
        <path d="M60,240 C140,226 260,226 340,240" />
        <path d="M60,290 C140,280 260,280 340,290" />
        <path d="M60,340 C140,334 260,334 340,340" />
        <path d="M60,390 C140,388 260,388 340,390" />
        <path d="M120,20 C96,160 96,320 130,450" />
        <path d="M160,14 C142,160 142,330 168,460" />
        <path d="M200,10 L200,470" />
        <path d="M240,14 C258,160 258,330 232,460" />
        <path d="M280,20 C304,160 304,320 270,450" />
        {/* 눈·입 엣지루프 */}
        <ellipse cx="156" cy="186" rx="26" ry="12" strokeWidth="1" />
        <ellipse cx="156" cy="186" rx="14" ry="6" strokeWidth="0.7" />
        <ellipse cx="244" cy="186" rx="26" ry="12" strokeWidth="1" />
        <ellipse cx="244" cy="186" rx="14" ry="6" strokeWidth="0.7" />
        <ellipse cx="200" cy="330" rx="34" ry="13" strokeWidth="1" />
        <ellipse cx="200" cy="330" rx="20" ry="6.5" strokeWidth="0.7" />
        <path d="M200,206 C212,238 214,266 200,296 C186,266 188,238 200,206 Z" strokeWidth="1" />
      </g>

      {/* 선택 아웃라인 */}
      <path
        className="wire-outline-draw stroke-celadon-600"
        strokeWidth="1.8"
        d="M200,36 C276,36 318,104 318,190 C318,288 272,406 200,428 C128,406 82,288 82,190 C82,104 124,36 200,36 Z"
      />

      {/* 바닥 그림자 */}
      <ellipse cx="200" cy="452" rx="96" ry="10" fill="rgba(43,33,25,0.16)" />
    </svg>
  );
}
