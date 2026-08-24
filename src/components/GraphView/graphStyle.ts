import type { NodeData } from '@antv/g6'

type NodeState = 'current' | 'highlighted' | 'filtered' | 'default'
type EdgeState = 'filtered' | 'default'

export interface NodeStyleConfig {
  size: [number, number]
  fill: string
  stroke: string
  lineWidth: number
  lineType: 'solid' | 'dashed'
  fillOpacity: number
  strokeOpacity: number
  labelFill: string
  fontWeight: number
}

export interface EdgeStyleConfig {
  stroke: string
  strokeOpacity: number
  labelFill: string
}

const NODE_STYLES: Record<NodeState, NodeStyleConfig> = {
  current:     { size: [120, 36], fill: '#1890ff', stroke: '#1890ff', lineWidth: 2, lineType: 'solid', fillOpacity: 1, strokeOpacity: 1, labelFill: '#ffffff', fontWeight: 600 },
  highlighted: { size: [100, 32], fill: '#e6f7ff', stroke: '#1890ff', lineWidth: 2, lineType: 'solid', fillOpacity: 1, strokeOpacity: 1, labelFill: '#1890ff', fontWeight: 500 },
  filtered:    { size: [90, 28], fill: '#808080', stroke: '#808080', lineWidth: 1, lineType: 'solid', fillOpacity: 0.15, strokeOpacity: 0.25, labelFill: '#808080', fontWeight: 400 },
  default:     { size: [90, 28], fill: '#ffffff', stroke: '#e8e8e8', lineWidth: 1, lineType: 'solid', fillOpacity: 1, strokeOpacity: 1, labelFill: '#333333', fontWeight: 400 },
}

const EDGE_STYLES: Record<EdgeState, EdgeStyleConfig> = {
  filtered:  { stroke: '#808080', strokeOpacity: 0.25, labelFill: '#808080' },
  default:   { stroke: '#8c8c8c', strokeOpacity: 1, labelFill: '#999999' },
}

export function getNodeState(d: NodeData): NodeState {
  if (d.data?.isCurrent) return 'current'
  if (d.data?.isHighlighted) return 'highlighted'
  if (d.data?.isFiltered) return 'filtered'
  return 'default'
}

export function getNodeStyle(d: NodeData): NodeStyleConfig {
  return NODE_STYLES[getNodeState(d)]
}

export function getEdgeState(d: any): EdgeState {
  return d.data?.isFiltered ? 'filtered' : 'default'
}

export function getEdgeStyle(d: any): EdgeStyleConfig {
  return EDGE_STYLES[getEdgeState(d)]
}

export { NODE_STYLES, EDGE_STYLES }
