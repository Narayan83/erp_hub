import { useEffect, useMemo, useRef, useState } from 'react'

type Props = {
  file: File
  title?: string
  onConfirm: (blob: Blob) => void
  onCancel: () => void
}

const STAGE_W = 480
const STAGE_H = 400
const OUTPUT_SIZE = 1000
const MIN_CROP = 60

type CropRect = { x: number; y: number; size: number }

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

export function ImageCropModal({ file, title, onConfirm, onCancel }: Props) {
  const [imgUrl, setImgUrl] = useState('')
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [zoom, setZoom] = useState(1)
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, size: 0 })
  const [busy, setBusy] = useState(false)
  const dragRef = useRef<{
    mode: 'move' | 'resize'
    startX: number
    startY: number
    crop: CropRect
  } | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setImgUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const bounds = useMemo(() => {
    if (!natural.w || !natural.h) return null
    const baseScale = Math.min(STAGE_W / natural.w, STAGE_H / natural.h)
    const scale = baseScale * zoom
    const w = natural.w * scale
    const h = natural.h * scale
    const left = (STAGE_W - w) / 2
    const top = (STAGE_H - h) / 2
    return { scale, w, h, left, top }
  }, [natural, zoom])

  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const el = e.currentTarget
    setNatural({ w: el.naturalWidth, h: el.naturalHeight })
  }

  useEffect(() => {
    if (!natural.w || !natural.h) return
    setZoom(1)
    const baseScale = Math.min(STAGE_W / natural.w, STAGE_H / natural.h)
    const w = natural.w * baseScale
    const h = natural.h * baseScale
    const left = (STAGE_W - w) / 2
    const top = (STAGE_H - h) / 2
    const maxSize = Math.min(w, h)
    const size = Math.max(MIN_CROP, maxSize * 0.85)
    setCrop({
      x: left + (w - size) / 2,
      y: top + (h - size) / 2,
      size,
    })
  }, [natural.w, natural.h])

  useEffect(() => {
    if (!bounds) return
    setCrop((c) => {
      const maxSize = Math.min(bounds.w, bounds.h)
      const size = clamp(c.size, MIN_CROP, maxSize)
      const x = clamp(c.x, bounds.left, bounds.left + bounds.w - size)
      const y = clamp(c.y, bounds.top, bounds.top + bounds.h - size)
      return { x, y, size }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds?.w, bounds?.h, bounds?.left, bounds?.top])

  const startDrag = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, crop }
    const stage = e.currentTarget as HTMLElement
    stage.setPointerCapture?.(e.pointerId)

    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || !bounds) return
      const dx = ev.clientX - drag.startX
      const dy = ev.clientY - drag.startY
      if (drag.mode === 'move') {
        const x = clamp(drag.crop.x + dx, bounds.left, bounds.left + bounds.w - drag.crop.size)
        const y = clamp(drag.crop.y + dy, bounds.top, bounds.top + bounds.h - drag.crop.size)
        setCrop({ ...drag.crop, x, y })
      } else {
        const maxSize = Math.min(
          bounds.left + bounds.w - drag.crop.x,
          bounds.top + bounds.h - drag.crop.y,
        )
        const delta = Math.max(dx, dy)
        const size = clamp(drag.crop.size + delta, MIN_CROP, maxSize)
        setCrop({ ...drag.crop, size })
      }
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const confirm = async () => {
    if (!bounds) return
    setBusy(true)
    try {
      const img = new Image()
      img.src = imgUrl
      await new Promise((resolve, reject) => {
        if (img.complete && img.naturalWidth) resolve(null)
        img.onload = () => resolve(null)
        img.onerror = reject
      })
      const srcX = (crop.x - bounds.left) / bounds.scale
      const srcY = (crop.y - bounds.top) / bounds.scale
      const srcSize = crop.size / bounds.scale
      const canvas = document.createElement('canvas')
      canvas.width = OUTPUT_SIZE
      canvas.height = OUTPUT_SIZE
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas not supported')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
      ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9),
      )
      if (!blob) throw new Error('Failed to export image')
      onConfirm(blob)
    } catch {
      alert('Failed to crop image. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel} role="presentation">
      <div className="modal crop-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Crop image">
        <h2>Crop image{title ? ` — ${title}` : ''}</h2>
        <div
          className="crop-stage"
          style={{ width: STAGE_W, height: STAGE_H }}
          onPointerDown={startDrag('move')}
        >
          {imgUrl && (
            <img
              src={imgUrl}
              alt="To crop"
              onLoad={onImgLoad}
              draggable={false}
              className="crop-stage-img"
              style={
                bounds
                  ? {
                      width: bounds.w,
                      height: bounds.h,
                      left: bounds.left,
                      top: bounds.top,
                    }
                  : undefined
              }
            />
          )}
          {bounds && (
            <>
              <div
                className="crop-mask"
                style={{
                  clipPath: `polygon(0 0, 0 100%, ${crop.x}px 100%, ${crop.x}px ${crop.y}px, ${
                    crop.x + crop.size
                  }px ${crop.y}px, ${crop.x + crop.size}px ${crop.y + crop.size}px, ${crop.x}px ${
                    crop.y + crop.size
                  }px, ${crop.x}px 100%, 100% 100%, 100% 0)`,
                }}
              />
              <div
                className="crop-rect"
                style={{ left: crop.x, top: crop.y, width: crop.size, height: crop.size }}
                onPointerDown={startDrag('move')}
              >
                <div
                  className="crop-handle crop-handle-se"
                  onPointerDown={startDrag('resize')}
                />
              </div>
            </>
          )}
        </div>
        <label className="crop-zoom">
          <span>Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        <p className="hint" style={{ margin: 0 }}>
          Drag the box to reposition, drag the corner handle to resize, use zoom to get closer.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void confirm()} disabled={busy || !bounds}>
            {busy ? 'Processing…' : 'Use image'}
          </button>
        </div>
      </div>
    </div>
  )
}
