import { useEffect, useRef, useState } from 'react'

interface Props {
  darkMode?: boolean
}

export default function ShaderBackground({ darkMode = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Brief opacity-0 during shader recompile so there's no black/white flash
  const [fading, setFading] = useState(false)

  useEffect(() => {
    setFading(true)
    const fadeTimer = setTimeout(() => setFading(false), 380)
    return () => clearTimeout(fadeTimer)
  }, [darkMode])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl')
    if (!gl) {
      console.warn('WebGL not supported')
      return
    }

    const vsSource = `
      attribute vec4 aVertexPosition;
      void main() {
        gl_Position = aVertexPosition;
      }
    `

    // Dark palette (DESIGN_1.md): bg #1f0f0f→#2c1b1b, lines #e0071a (saturated red glow)
    // Light palette (DESIGN.md):  bg #FFFFFF→#f5f3f1, lines #c8102e (bold red on cream)
    const lineColorVec = darkMode
      ? 'vec4(0.878, 0.027, 0.102, 1.0)'
      : 'vec4(0.96, 0.05, 0.14, 1.0)'

    const bg1Vec = darkMode
      ? 'vec4(0.122, 0.059, 0.059, 1.0)'
      : 'vec4(0.976, 0.955, 0.914, 1.0)'

    const bg2Vec = darkMode
      ? 'vec4(0.173, 0.106, 0.106, 1.0)'
      : 'vec4(0.949, 0.923, 0.866, 1.0)'

    // Dark: additive blend → lines glow on dark crimson background
    // Light: mix blend  → lines tint into cream without blowing out
    const blendCode = darkMode
      ? `
        vec4 bg = mix(bgColor1, bgColor2, uv.x) * verticalFade;
        bg.a = 1.0;
        gl_FragColor = clamp(bg + lines, 0.0, 1.0);
      `
      : `
        vec4 bg = mix(bgColor1, bgColor2, uv.x);
        float vignette = mix(0.93, 1.0, verticalFade);
        bg *= vignette;
        bg.a = 1.0;
        float mask = min(lineMask * lineMask * 2.5 + lineMask * 0.4, 1.0);
        gl_FragColor = mix(bg, vec4(lineColor.rgb, 1.0), mask);
      `

    const fsSource = `
      precision highp float;
      uniform vec2 iResolution;
      uniform float iTime;

      const float overallSpeed    = 0.2;
      const float gridSmoothWidth = 0.015;
      const float minLineWidth    = 0.01;
      const float maxLineWidth    = 0.2;
      const float lineSpeed       = 1.0 * overallSpeed;
      const float lineAmplitude   = 1.0;
      const float lineFrequency   = 0.2;
      const float warpSpeed       = 0.2 * overallSpeed;
      const float warpFrequency   = 0.5;
      const float warpAmplitude   = 1.0;
      const float offsetFrequency = 0.5;
      const float offsetSpeed     = 1.33 * overallSpeed;
      const float minOffsetSpread = 0.6;
      const float maxOffsetSpread = 2.0;
      const float scale           = 5.0;
      const int   linesPerGroup   = 16;

      const vec4 lineColor = ${lineColorVec};
      const vec4 bgColor1  = ${bg1Vec};
      const vec4 bgColor2  = ${bg2Vec};

      #define drawCircle(pos, radius, coord) \
        smoothstep(radius + gridSmoothWidth, radius, length(coord - (pos)))
      #define drawSmoothLine(pos, halfWidth, t) \
        smoothstep(halfWidth, 0.0, abs(pos - (t)))
      #define drawCrispLine(pos, halfWidth, t) \
        smoothstep(halfWidth + gridSmoothWidth, halfWidth, abs(pos - (t)))

      float random(float t) {
        return (cos(t) + cos(t * 1.3 + 1.3) + cos(t * 1.4 + 1.4)) / 3.0;
      }

      float getPlasmaY(float x, float hFade, float offset) {
        return random(x * lineFrequency + iTime * lineSpeed) * hFade * lineAmplitude + offset;
      }

      void main() {
        vec2  uv    = gl_FragCoord.xy / iResolution.xy;
        vec2  space = (gl_FragCoord.xy - iResolution.xy / 2.0) / iResolution.x * 2.0 * scale;

        float horizontalFade = 1.0 - (cos(uv.x * 6.28) * 0.5 + 0.5);
        float verticalFade   = 1.0 - (cos(uv.y * 6.28) * 0.5 + 0.5);

        space.y += random(space.x * warpFrequency + iTime * warpSpeed)
                   * warpAmplitude * (0.5 + horizontalFade);
        space.x += random(space.y * warpFrequency + iTime * warpSpeed + 2.0)
                   * warpAmplitude * horizontalFade;

        vec4  lines    = vec4(0.0);
        float lineMask = 0.0;

        for (int l = 0; l < linesPerGroup; l++) {
          float nIdx           = float(l) / float(linesPerGroup);
          float offsetTime     = iTime * offsetSpeed;
          float offsetPosition = float(l) + space.x * offsetFrequency;
          float rand           = random(offsetPosition + offsetTime) * 0.5 + 0.5;
          float halfWidth      = mix(minLineWidth, maxLineWidth, rand * horizontalFade) / 2.0;
          float spread         = mix(minOffsetSpread, maxOffsetSpread, horizontalFade);
          float offset         = random(offsetPosition + offsetTime * (1.0 + nIdx)) * spread;
          float linePos        = getPlasmaY(space.x, horizontalFade, offset);
          float line           = drawSmoothLine(linePos, halfWidth, space.y) / 2.0
                               + drawCrispLine(linePos, halfWidth * 0.15, space.y);
          float circleX        = mod(float(l) + iTime * lineSpeed, 25.0) - 12.0;
          vec2  circlePos      = vec2(circleX, getPlasmaY(circleX, horizontalFade, offset));
          float circle         = drawCircle(circlePos, 0.01, space) * 4.0;
          line     += circle;
          lines    += line * lineColor * rand;
          lineMask += line * rand;
        }
        lineMask = min(lineMask, 1.0);

        ${blendCode}
      }
    `

    const loadShader = (type: number, source: string) => {
      const shader = gl.createShader(type)
      if (!shader) return null
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader))
        gl.deleteShader(shader)
        return null
      }
      return shader
    }

    const vs = loadShader(gl.VERTEX_SHADER, vsSource)
    const fs = loadShader(gl.FRAGMENT_SHADER, fsSource)
    if (!vs || !fs) return

    const program = gl.createProgram()
    if (!program) return
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program))
      return
    }

    const posBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

    const posLoc  = gl.getAttribLocation(program, 'aVertexPosition')
    const resLoc  = gl.getUniformLocation(program, 'iResolution')
    const timeLoc = gl.getUniformLocation(program, 'iTime')

    const resize = () => {
      canvas.width  = window.innerWidth
      canvas.height = window.innerHeight
      gl.viewport(0, 0, canvas.width, canvas.height)
    }
    window.addEventListener('resize', resize)
    resize()

    let animId: number
    const t0 = Date.now()

    const render = () => {
      const t = (Date.now() - t0) / 1000
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(program)
      gl.uniform2f(resLoc, canvas.width, canvas.height)
      gl.uniform1f(timeLoc, t)
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)
      gl.enableVertexAttribArray(posLoc)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      animId = requestAnimationFrame(render)
    }
    render()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.deleteBuffer(posBuf)
    }
  }, [darkMode])

  return (
    <>
      {/* Solid base colour sits just below the canvas — prevents white/black flash during shader recompile */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: -11,
          backgroundColor: darkMode ? '#1f0f0f' : '#F6F0E3',
          transition: 'background-color 0.4s ease',
          pointerEvents: 'none',
        }}
      />
      <canvas
        ref={canvasRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: -10,
          opacity: fading ? 0 : 1,
          transition: 'opacity 0.3s ease',
          pointerEvents: 'none',
        }}
      />
    </>
  )
}
