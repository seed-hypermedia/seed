// Polyfill DOMMatrix for pdfjs-dist in jsdom
if (typeof globalThis.DOMMatrix === 'undefined') {
  class DOMMatrixPolyfill {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
    m11 = 1; m12 = 0; m13 = 0; m14 = 0
    m21 = 0; m22 = 1; m23 = 0; m24 = 0
    m31 = 0; m32 = 0; m33 = 1; m34 = 0
    m41 = 0; m42 = 0; m43 = 0; m44 = 1
    is2D = true
    isIdentity = true

    constructor(init?: string | number[]) {
      if (Array.isArray(init) && init.length >= 6) {
        this.a = this.m11 = init[0]!
        this.b = this.m12 = init[1]!
        this.c = this.m21 = init[2]!
        this.d = this.m22 = init[3]!
        this.e = this.m41 = init[4]!
        this.f = this.m42 = init[5]!
      }
    }

    inverse() { return new DOMMatrixPolyfill() }
    multiply() { return new DOMMatrixPolyfill() }
    translate() { return new DOMMatrixPolyfill() }
    scale() { return new DOMMatrixPolyfill() }
    rotate() { return new DOMMatrixPolyfill() }
    transformPoint(point?: {x?: number; y?: number}) {
      return {x: point?.x || 0, y: point?.y || 0, z: 0, w: 1}
    }
  }

  // @ts-expect-error polyfill
  globalThis.DOMMatrix = DOMMatrixPolyfill
}

// Polyfill Path2D
if (typeof globalThis.Path2D === 'undefined') {
  class Path2DPolyfill {
    moveTo() {}
    lineTo() {}
    closePath() {}
    rect() {}
    arc() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
  }
  // @ts-expect-error polyfill
  globalThis.Path2D = Path2DPolyfill
}
