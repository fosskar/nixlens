// Package web holds the built ui.
package web

import "embed"

// Dist is the vite build; npm run build creates it
//
//go:embed all:dist
var Dist embed.FS
