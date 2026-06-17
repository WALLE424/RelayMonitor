param()

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$iconDir = Join-Path $root "src\assets\icons"
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null

function New-RoundedRectanglePath {
    param([float]$X, [float]$Y, [float]$Width, [float]$Height, [float]$Radius)

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $Radius * 2
    $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
    $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
    $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-SolidBrush {
    param([int]$A, [int]$R, [int]$G, [int]$B)
    return New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($A, $R, $G, $B))
}

function New-ColorPen {
    param([int]$A, [int]$R, [int]$G, [int]$B, [float]$Width)
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb($A, $R, $G, $B)), $Width
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    return $pen
}

function Fill-Circle {
    param($Graphics, [float]$X, [float]$Y, [float]$R, $Brush)
    $Graphics.FillEllipse($Brush, $X - $R, $Y - $R, $R * 2, $R * 2)
}

function Draw-GlassLine {
    param($Graphics, [float[]]$Points, $Pen)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddCurve(@(
        (New-Object System.Drawing.PointF ([float]$Points[0]), ([float]$Points[1])),
        (New-Object System.Drawing.PointF ([float]$Points[2]), ([float]$Points[3])),
        (New-Object System.Drawing.PointF ([float]$Points[4]), ([float]$Points[5])),
        (New-Object System.Drawing.PointF ([float]$Points[6]), ([float]$Points[7]))
    ), 0.55)
    $Graphics.DrawPath($Pen, $path)
    $path.Dispose()
}

function Save-IconPng {
    param([int]$Size, [string]$Path)

    $bitmap = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::FromArgb(255, 255, 250, 252))

    $pad = [Math]::Max(1, [Math]::Round($Size * 0.055))
    $outerSize = $Size - $pad * 2
    $outer = New-RoundedRectanglePath $pad $pad $outerSize $outerSize ([Math]::Round($Size * 0.23))
    $outerRect = New-Object System.Drawing.Rectangle $pad, $pad, $outerSize, $outerSize
    $outerBg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $outerRect, `
        ([System.Drawing.Color]::FromArgb(255, 255, 255, 255)), `
        ([System.Drawing.Color]::FromArgb(255, 241, 251, 248)), 135
    $graphics.FillPath($outerBg, $outer)

    $glowPink = New-SolidBrush 106 240 154 181
    $glowMint = New-SolidBrush 96 85 199 179
    $glowWarm = New-SolidBrush 72 217 155 67
    Fill-Circle $graphics ($Size * 0.24) ($Size * 0.26) ($Size * 0.24) $glowPink
    Fill-Circle $graphics ($Size * 0.76) ($Size * 0.72) ($Size * 0.25) $glowMint
    Fill-Circle $graphics ($Size * 0.77) ($Size * 0.28) ($Size * 0.16) $glowWarm

    $innerPad = [Math]::Round($Size * 0.14)
    $panel = New-RoundedRectanglePath $innerPad $innerPad ($Size - $innerPad * 2) ($Size - $innerPad * 2) ([Math]::Round($Size * 0.17))
    $panelBrush = New-SolidBrush 228 255 255 255
    $graphics.FillPath($panelBrush, $panel)

    $dialCenterX = $Size * 0.50
    $dialCenterY = $Size * 0.61
    $dialRadius = $Size * 0.285
    $dialBackPen = New-ColorPen 112 220 176 191 ([Math]::Max(3, $Size * 0.050))
    $dialMintPen = New-ColorPen 255 85 199 179 ([Math]::Max(4, $Size * 0.065))
    $dialRosePen = New-ColorPen 255 240 154 181 ([Math]::Max(4, $Size * 0.065))
    $dialWarmPen = New-ColorPen 255 217 155 67 ([Math]::Max(4, $Size * 0.065))
    $dialRect = New-Object System.Drawing.RectangleF ([float]($dialCenterX - $dialRadius)), ([float]($dialCenterY - $dialRadius)), ([float]($dialRadius * 2)), ([float]($dialRadius * 2))
    $graphics.DrawArc($dialBackPen, $dialRect, 205, 130)
    $graphics.DrawArc($dialMintPen, $dialRect, 205, 46)
    $graphics.DrawArc($dialRosePen, $dialRect, 252, 42)
    $graphics.DrawArc($dialWarmPen, $dialRect, 295, 40)

    $needlePen = New-ColorPen 255 49 42 52 ([Math]::Max(3, $Size * 0.036))
    $graphics.DrawLine($needlePen, $dialCenterX, $dialCenterY, ($Size * 0.66), ($Size * 0.47))
    $hub = New-SolidBrush 255 49 42 52
    Fill-Circle $graphics $dialCenterX $dialCenterY ([Math]::Max(3, $Size * 0.042)) $hub

    $flowPen = New-ColorPen 255 85 199 179 ([Math]::Max(2, $Size * 0.034))
    Draw-GlassLine $graphics @(
        ($Size * 0.24), ($Size * 0.36),
        ($Size * 0.37), ($Size * 0.27),
        ($Size * 0.56), ($Size * 0.33),
        ($Size * 0.76), ($Size * 0.23)
    ) $flowPen

    $nodeDark = New-SolidBrush 255 49 42 52
    $nodeMint = New-SolidBrush 255 85 199 179
    $nodeRose = New-SolidBrush 255 240 154 181
    $nodeWarm = New-SolidBrush 255 217 155 67
    $nodeR = [Math]::Max(3, $Size * 0.055)
    Fill-Circle $graphics ($Size * 0.24) ($Size * 0.36) $nodeR $nodeMint
    Fill-Circle $graphics ($Size * 0.43) ($Size * 0.28) $nodeR $nodeRose
    Fill-Circle $graphics ($Size * 0.60) ($Size * 0.33) $nodeR $nodeMint
    Fill-Circle $graphics ($Size * 0.76) ($Size * 0.23) $nodeR $nodeWarm

    if ($Size -ge 48) {
        $tickPen = New-ColorPen 142 49 42 52 ([Math]::Max(1, $Size * 0.014))
        foreach ($angle in @(210, 240, 270, 300, 330)) {
            $r1 = $dialRadius * 0.78
            $r2 = $dialRadius * 0.94
            $rad = [Math]::PI * $angle / 180
            $graphics.DrawLine(
                $tickPen,
                ($dialCenterX + [Math]::Cos($rad) * $r1),
                ($dialCenterY + [Math]::Sin($rad) * $r1),
                ($dialCenterX + [Math]::Cos($rad) * $r2),
                ($dialCenterY + [Math]::Sin($rad) * $r2)
            )
        }
        $sparkPen = New-ColorPen 235 49 42 52 ([Math]::Max(2, $Size * 0.026))
        $graphics.DrawLines($sparkPen, @(
            (New-Object System.Drawing.PointF ([float]($Size * 0.28)), ([float]($Size * 0.80))),
            (New-Object System.Drawing.PointF ([float]($Size * 0.39)), ([float]($Size * 0.75))),
            (New-Object System.Drawing.PointF ([float]($Size * 0.51)), ([float]($Size * 0.78))),
            (New-Object System.Drawing.PointF ([float]($Size * 0.65)), ([float]($Size * 0.72))),
            (New-Object System.Drawing.PointF ([float]($Size * 0.75)), ([float]($Size * 0.74)))
        ))
        $sparkPen.Dispose()
        $tickPen.Dispose()
    } else {
        Fill-Circle $graphics ($Size * 0.50) ($Size * 0.70) ([Math]::Max(3, $Size * 0.12)) $nodeDark
    }

    $shineBrush = New-SolidBrush 88 255 255 255
    $graphics.FillEllipse($shineBrush, ($Size * 0.22), ($Size * 0.18), ($Size * 0.28), ($Size * 0.12))

    $borderOuter = New-ColorPen 255 220 176 191 ([Math]::Max(1, $Size * 0.020))
    $borderInner = New-ColorPen 165 255 255 255 ([Math]::Max(1, $Size * 0.012))
    $graphics.DrawPath($borderOuter, $outer)
    $graphics.DrawPath($borderInner, $panel)

    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

    foreach ($item in @($borderInner, $borderOuter, $shineBrush, $nodeWarm, $nodeRose, $nodeMint, $nodeDark, $hub, $flowPen, $needlePen, $dialWarmPen, $dialRosePen, $dialMintPen, $dialBackPen, $panelBrush, $glowWarm, $glowMint, $glowPink, $outerBg, $graphics, $bitmap, $outer, $panel)) {
        if ($item -and ($item -is [System.IDisposable])) { $item.Dispose() }
    }
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngEntries = @()
foreach ($size in $sizes) {
    $pngPath = Join-Path $iconDir "app-icon-$size.png"
    Save-IconPng -Size $size -Path $pngPath
    $pngEntries += [pscustomobject]@{ Size = $size; Path = $pngPath; Bytes = [System.IO.File]::ReadAllBytes($pngPath) }
}

Copy-Item -Force (Join-Path $iconDir "app-icon-256.png") (Join-Path $iconDir "app-icon.png")

$icoPath = Join-Path $iconDir "app-icon.ico"
$stream = New-Object System.IO.FileStream $icoPath, ([System.IO.FileMode]::Create), ([System.IO.FileAccess]::Write)
$writer = New-Object System.IO.BinaryWriter $stream
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$pngEntries.Count)
$offset = 6 + ($pngEntries.Count * 16)
foreach ($entry in $pngEntries) {
    $writer.Write([byte]($(if ($entry.Size -eq 256) { 0 } else { $entry.Size })))
    $writer.Write([byte]($(if ($entry.Size -eq 256) { 0 } else { $entry.Size })))
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$entry.Bytes.Length)
    $writer.Write([UInt32]$offset)
    $offset += $entry.Bytes.Length
}
foreach ($entry in $pngEntries) {
    $writer.Write($entry.Bytes)
}
$writer.Dispose()
$stream.Dispose()

Write-Host "Generated Relay Monitor icon files in $iconDir"
