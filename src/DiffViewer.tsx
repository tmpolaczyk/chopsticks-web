import _ from 'lodash'
import React, { useCallback, useMemo, useState } from 'react'
import { JSONTree } from 'react-json-tree'
import styled from 'styled-components'
import { spanButtonImage } from './images'

export type DiffViewerProps = {
  oldState: any
  delta: any
  newState: any
  // If true, events will look at oldState and calculate diff.
  // Set this when the oldState and newState are from the same block.
  // Because the normal operation is to have oldState be the previous block, so you will see the events from the previous block,
  // which just add noise.
  eventsUseDelta?: boolean
}

const expandFirstLevel = (_keyName: any, _data: any, level: number) => level <= 1

function stringifyAndShrink(val: any) {
  if (val == null) return 'null'
  if (typeof val === 'string') return val
  return JSON.stringify(val, null, 1)
}

function prepareDelta(value: any) {
  if (value && value._t === 'a') {
    const res = {} as any
    for (const key in value) {
      if (key !== '_t') {
        if (key[0] === '_' && !value[key.substring(1)]) {
          res[key.substring(1)] = value[key]
        } else if (value[`_${key}`]) {
          res[key] = [value[`_${key}`][0], value[key][0]]
        } else if (!value[`_${key}`] && key[0] !== '_') {
          res[key] = value[key]
        }
      }
    }
    return res
  }
  return value
}

const theme = {
  scheme: 'monokai',
  base00: '#272822',
  base01: '#383830',
  base02: '#49483e',
  base03: '#75715e',
  base04: '#a59f85',
  base05: '#f8f8f2',
  base06: '#f5f4f1',
  base07: '#f9f8f5',
  base08: '#f92672',
  base09: '#fd971f',
  base0A: '#f4bf75',
  base0B: '#a6e22e',
  base0C: '#a1efe4',
  base0D: '#66d9ef',
  base0E: '#ae81ff',
  base0F: '#cc6633',
}

const DiffSpan = styled.span`
  padding: 2px 4px;
  border-radius: 4px;
  position: relative;
  line-height: 150%;

  & > button {
    border: none;
    border-radius: 6px;
    padding: 6px;
    cursor: pointer;
    cursor: pointer;
    opacity: 60%;
    width: 26px;
    height: 26px;
    margin-left: 10px;
  }

  & > button > img {
    width: 100%;
    height: 100%;
  }

  & > button:hover {
    opacity: 100%;
  }

  li:has(> span > span.diffWrap > span.diffRemove) > label {
    color: red !important;
    text-decoration: line-through;
    text-decoration-thickness: 1px;
  }

  &.diffAdd {
    color: #428442;
    display: inline-flex;
  }

  &.diffRemove {
    text-decoration: line-through;
    text-decoration-thickness: 1px;
    color: red;
    display: inline-flex;
  }

  &.diffUpdateFrom {
    text-decoration: line-through;
    text-decoration-thickness: 1px;
    color: red;
    display: inline-flex;
  }

  &.diffUpdateTo {
    color: #428442;
    display: inline-flex;
  }

  &.diffUpdateArrow {
    color: #ccc;
  }

  &.unchanged {
    color: #666;
  }

  &.delta {
    color: #ccc;
    font-size: 12px;
    margin: 0 10px;
  }
`

const DiffWrapSpan = styled.span`
  position: relative;
  z-index: 1;
`

const PartialViewer = styled.div`
  min-width: 300px;
`

const MainViewer = styled.div`
  width: 80%;
`

enum ViewMode {
  Events = 'events',
  Changed = 'changed',
  Unchanged = 'unchanged',
}

// Make an event look like the non-delta view
function prettyEvent(raw: any) {
  if (!raw || typeof raw !== 'object') return raw
  const phase = typeof raw.phase === 'string' ? raw.phase : JSON.stringify(raw.phase)
  const ev = raw.event ?? {}
  const section = ev.section ?? raw.section
  const method = ev.method ?? raw.method
  const data = ev.data ?? raw.data
  if (!section || !method) return raw
  return { phase, kind: `${section}.${method}`, data }
}

// For jsondiffpatch array deltas (_t: 'a'), map the payloads in-place.
// Works for add, remove, and update pairs (key / _key).
function mapArrayDeltaInPlace(a: any, fn: (x: any) => any) {
  if (!a || a._t !== 'a') return a
  for (const k in a) {
    if (k === '_t') continue
    const v = a[k]
    if (Array.isArray(v) && v.length) v[0] = fn(v[0])
    const underscore = `_${k}`
    const u = a[underscore]
    if (Array.isArray(u) && u.length) u[0] = fn(u[0])
  }
  return a
}

// Return true is a is either of
// [null, []]
// [[], null]
// this is a hack to avoid showing empty UpwardMessages, happens in onInitialize and onFinalize in DryRunExtrinsic
function deltaEmpty(a: any) {
  const emptyish = (v: unknown) => v === null || (Array.isArray(v) && v.length === 0)
  return Array.isArray(a) && a.length === 2 && emptyish(a[0]) && emptyish(a[1])
}

function deltaNotEmpty(a: any) {
  return !deltaEmpty(a)
}

const DiffViewer: React.FC<DiffViewerProps> = ({ oldState, delta, newState, eventsUseDelta = false }) => {
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Events)
  const [partial, setPartial] = useState(null)

  const handleViewModeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setViewMode(e.target.value as ViewMode)
  }, [])

  const data = useMemo(() => {
    switch (viewMode) {
      case ViewMode.Unchanged:
        return _.merge(_.cloneDeep(oldState), delta)
      case ViewMode.Changed:
        return delta
      case ViewMode.Events: {
        if (eventsUseDelta) {
          // TODO: this way makes events look a bit ugly because they are encoded as a string, not an object, so
          // you see phase:
          // { "phase": "{\"ApplyExtrinsic\":\"4\"}",
          // Maybe a better solution would be to use the regular, non-diff viewer, but manually remove the events based on oldData
          const sys = _.get(delta, 'system.events')
          const up = _.get(delta, 'parachainSystem.upwardMessages')
          const dn = _.get(delta, 'dmp.downwardMessageQueues')
          const hr = _.get(delta, 'parachainSystem.hrmpOutboundMessages')

          const eventOnlyDelta: any = {}

          if (sys) {
            const sysCloned = _.cloneDeep(sys) // don’t mutate the original delta
            mapArrayDeltaInPlace(sysCloned, prettyEvent) // shape entries to {phase, kind, data}
            eventOnlyDelta.SystemEvents = sysCloned
          }
          if (up && deltaNotEmpty(up)) eventOnlyDelta.UpwardMessages = up
          if (dn && deltaNotEmpty(dn)) eventOnlyDelta.DownwardMessages = dn
          if (hr && deltaNotEmpty(hr)) eventOnlyDelta.HorizontalMessages = hr

          return eventOnlyDelta
        }

        // unchanged non-delta Events view
        const events = _.get(newState, 'system.events')?.map((e: any) => ({
          phase: typeof e.phase === 'string' ? e.phase : JSON.stringify(e.phase),
          kind: `${e.event.section}.${e.event.method}`,
          data: e.event.data,
        }))
        const upwardMessages = _.get(newState, 'parachainSystem.upwardMessages')
        const downwardMessages = _.get(newState, 'dmp.downwardMessageQueues')
        const horizontalMessages = _.get(newState, 'parachainSystem.hrmpOutboundMessages')
        return {
          ...(upwardMessages?.length ? { UpwardMessages: upwardMessages } : {}),
          ...(downwardMessages ? { DownwardMessages: downwardMessages } : {}),
          ...(horizontalMessages?.length ? { HorizontalMessages: horizontalMessages } : {}),
          SystemEvents: events,
        }
      }
      default:
        throw new Error(`Unsupported view mode: ${viewMode}`)
    }
  }, [oldState, delta, newState, viewMode, eventsUseDelta])

  const viewPartial = useCallback((value: any) => {
    setPartial((partial) => (_.isEqual(partial, value) ? null : value))
  }, [])

  function valueRenderer(viewPartial: any, deltaForIsDelta: any) {
    return (_raw: any, value: any, ...keys: any[]) => {
      const modifyPath = keys.reverse().join('.')
      const removePath = keys.map((x) => (Number.isInteger(Number.parseInt(x)) ? `_${x}` : x)).join('.')
      const isDelta = _.has(deltaForIsDelta, modifyPath) || _.has(deltaForIsDelta, removePath)

      function renderSpan(name: string, body: any, raw?: any) {
        return (
          <DiffSpan key={name} className={name}>
            {body}
            {_.isObjectLike(raw) ? (
              <button type="button" onClick={() => viewPartial({ [modifyPath]: raw })}>
                <img alt="" src={spanButtonImage} />
              </button>
            ) : null}
          </DiffSpan>
        )
      }

      function renderDelta(v: any) {
        const isNumLike = (x: any) => (typeof x === 'string' || typeof x === 'number') && /^\d+(,\d+)*$/.test(String(x))
        if (Array.isArray(v) && v.length === 2 && isNumLike(v[0]) && isNumLike(v[1])) {
          const toBigInt = (x: any) => (typeof x === 'string' ? BigInt(x.replace(/,/g, '')) : BigInt(x))
          const oldValue = toBigInt(v[0])
          const newValue = toBigInt(v[1])
          if (oldValue > 0n && newValue > 0n) {
            const d = newValue - oldValue
            return (
              <span className="delta">
                {d > 0n ? '+' : ''}
                {Number(d).toLocaleString()}
              </span>
            )
          }
        }
      }

      if (isDelta && Array.isArray(value)) {
        switch (value.length) {
          case 0:
            return <DiffWrapSpan>{renderSpan('diff', '[]')}</DiffWrapSpan>
          case 1:
            return <DiffWrapSpan>{renderSpan('diffAdd', stringifyAndShrink(value[0]), value[0])}</DiffWrapSpan>
          case 2:
            return (
              <DiffWrapSpan>
                {renderSpan('diffUpdateFrom', stringifyAndShrink(value[0]), value[0])}
                {renderSpan('diffUpdateArrow', ' => ')}
                {renderSpan('diffUpdateTo', stringifyAndShrink(value[1]), value[1])}
                {renderDelta(value)}
              </DiffWrapSpan>
            )
          case 3:
            return <DiffWrapSpan>{renderSpan('diffRemove', stringifyAndShrink(value[0]), value[0])}</DiffWrapSpan>
        }
      }

      return <DiffWrapSpan>{renderSpan('unchanged', stringifyAndShrink(value), value)}</DiffWrapSpan>
    }
  }

  const activeDeltaForRenderer =
    viewMode === ViewMode.Changed
      ? delta
      : viewMode === ViewMode.Events && eventsUseDelta
        ? data // the event-only delta object we just built
        : delta // unused in non-delta rendering

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'row' }}>
        <MainViewer>
          <input
            type="radio"
            id="show_events"
            name="viewMode"
            value="events"
            checked={viewMode === 'events'}
            onChange={handleViewModeChange}
          />
          <label htmlFor="show_events">Events</label>
          <input
            type="radio"
            id="show_changed"
            name="viewMode"
            value="changed"
            checked={viewMode === 'changed'}
            onChange={handleViewModeChange}
          />
          <label htmlFor="show_changed">Changed</label>
          <input
            type="radio"
            id="show_unchanged"
            name="viewMode"
            value="unchanged"
            checked={viewMode === 'unchanged'}
            onChange={handleViewModeChange}
          />
          <label htmlFor="show_unchanged">Unchanged</label>
          {viewMode === ViewMode.Events ? (
            eventsUseDelta ? (
              <JSONTree
                theme={theme}
                invertTheme
                data={data}
                valueRenderer={valueRenderer(viewPartial, activeDeltaForRenderer)}
                postprocessValue={prepareDelta}
                isCustomNode={Array.isArray}
                shouldExpandNodeInitially={(_k, _d, l) => l <= 3}
                hideRoot
              />
            ) : (
              <JSONTree theme={theme} invertTheme data={data} shouldExpandNodeInitially={(_k, _d, l) => l <= 3} hideRoot />
            )
          ) : (
            <JSONTree
              theme={theme}
              invertTheme={true}
              data={data}
              valueRenderer={valueRenderer(viewPartial, activeDeltaForRenderer)}
              postprocessValue={prepareDelta}
              isCustomNode={Array.isArray}
              shouldExpandNodeInitially={expandFirstLevel}
              hideRoot
            />
          )}
        </MainViewer>
        {partial ? (
          <PartialViewer>
            <JSONTree theme={theme} invertTheme={true} data={partial} shouldExpandNodeInitially={() => true} hideRoot />
          </PartialViewer>
        ) : null}
      </div>
    </div>
  )
}

const DiffViewerFC = React.memo(DiffViewer)

export default DiffViewerFC
