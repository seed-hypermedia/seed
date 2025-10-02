import {
  CategoryScale,
  Chart as ChartJS,
  ChartOptions,
  CoreScaleOptions,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Scale,
  Title,
  Tooltip,
  TooltipItem,
} from 'chart.js'
import React from 'react'
import {Line} from 'react-chartjs-2'
import type {WebPerformanceResult} from '../types'
import {formatDate} from '../utils/format'

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
)

interface WebPerformanceTrendsProps {
  results: WebPerformanceResult[]
  metric: keyof WebPerformanceResult['mobile']
  device: 'mobile' | 'desktop'
  title: string
  unit?: string
}

export const WebPerformanceTrends: React.FC<WebPerformanceTrendsProps> = ({
  results,
  metric,
  device,
  title,
  unit = '',
}) => {
  // Sort results by date
  const sortedResults = [...results].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  )

  const data = {
    labels: sortedResults.map((result) => formatDate(result.timestamp)),
    datasets: [
      {
        label: `${title} (${device})`,
        data: sortedResults.map((result) => result[device][metric]),
        borderColor:
          device === 'mobile' ? 'rgb(59, 130, 246)' : 'rgb(147, 51, 234)',
        backgroundColor:
          device === 'mobile'
            ? 'rgba(59, 130, 246, 0.5)'
            : 'rgba(147, 51, 234, 0.5)',
        tension: 0.3,
      },
    ],
  }

  const options: ChartOptions<'line'> = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (context: TooltipItem<'line'>) => {
            let label = context.dataset.label || ''
            if (label) {
              label += ': '
            }
            if (context.parsed.y !== null) {
              if (unit === 'bytes') {
                label += formatBytes(context.parsed.y)
              } else if (unit === 'ms') {
                if (context.parsed.y >= 1000) {
                  label += `${(context.parsed.y / 1000).toFixed(2)}s`
                } else {
                  label += `${context.parsed.y.toFixed(0)}ms`
                }
              } else {
                label += context.parsed.y.toFixed(2)
              }
            }
            return label
          },
        },
      },
    },
    scales: {
      y: {
        type: 'linear' as const,
        beginAtZero: true,
        ticks: {
          callback: function (
            this: Scale<CoreScaleOptions>,
            tickValue: string | number,
          ) {
            const value = Number(tickValue)
            if (unit === 'bytes') {
              return formatBytes(value)
            } else if (unit === 'ms') {
              if (value >= 1000) {
                return `${(value / 1000).toFixed(1)}s`
              }
              return `${value}ms`
            }
            return value
          },
        },
      },
    },
  }

  return (
    <div className="rounded-lg bg-white p-4 shadow">
      <h3 className="mb-4 text-lg font-medium text-gray-900">{title} Trend</h3>
      <div className="h-64">
        <Line data={data} options={options} />
      </div>
    </div>
  )
}

// Helper function to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

export default WebPerformanceTrends
