# Genera la card statistiche per il post Patreon (PNG 1200x630).
# Uso: powershell -File scripts/make-patreon-card.ps1
# Output: docs/patreon-stats-card.png
Add-Type -AssemblyName System.Drawing

$W = 1200
$H = 630
$out = Join-Path $PSScriptRoot '..\docs\patreon-stats-card.png'
$out = [System.IO.Path]::GetFullPath($out)

$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

# Sfondo: gradiente verticale scuro
$rect = New-Object System.Drawing.Rectangle(0, 0, $W, $H)
$c1 = [System.Drawing.Color]::FromArgb(255, 11, 18, 32)
$c2 = [System.Drawing.Color]::FromArgb(255, 15, 23, 42)
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 90)
$g.FillRectangle($grad, $rect)

# Alone decorativo in alto a destra
$glow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(18, 56, 189, 248))
$g.FillEllipse($glow, 880, -220, 520, 520)

# Barra accento a sinistra
$accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 56, 189, 248))
$g.FillRectangle($accent, 0, 0, 6, $H)

function New-Font([string]$name, [float]$size, [System.Drawing.FontStyle]$style) {
    New-Object System.Drawing.Font($name, $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
}

$fBadge = New-Font 'Segoe UI' 14 ([System.Drawing.FontStyle]::Bold)
$fTitle = New-Font 'Segoe UI' 44 ([System.Drawing.FontStyle]::Bold)
$fSub = New-Font 'Segoe UI' 21 ([System.Drawing.FontStyle]::Regular)
$fBig = New-Font 'Segoe UI' 40 ([System.Drawing.FontStyle]::Bold)
$fLabel = New-Font 'Segoe UI' 15 ([System.Drawing.FontStyle]::Regular)
$fFoot = New-Font 'Segoe UI' 14 ([System.Drawing.FontStyle]::Regular)

$bWhite = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$bMuted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 148, 163, 184))
$bDim = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 100, 116, 139))
$bSky = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 56, 189, 248))
$bGreen = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 52, 211, 153))

$dot = [char]0x00B7
$g.DrawString("OPEN SOURCE  $dot  LICENZA MIT  $dot  ZERO TELEMETRIA", $fBadge, $bGreen, 80, 58)
$g.DrawString('SQL Intelligence Assistant', $fTitle, $bWhite, 80, 92)
$g.DrawString('Il client SQL che conosce il tuo database', $fSub, $bMuted, 82, 156)

# Linea divisoria
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 30, 41, 59), 1)
$g.DrawLine($pen, 80, 214, 1120, 214)

# Griglia statistiche 3 x 2
$stats = @(
    @('250', 'commit in 63 giorni'),
    @('1.522', 'test automatici, tutti verdi'),
    @('31.500', 'righe di codice applicativo'),
    @('286', 'tabelle reali usate nei test'),
    @('2.200+', 'legami nel grafo delle chiamate'),
    @('0', 'telemetria, analytics, tracker')
)
$colX = @(80, 440, 800)
$rowY = @(266, 426)
for ($i = 0; $i -lt $stats.Count; $i++) {
    $x = $colX[$i % 3]
    $y = $rowY[[Math]::Floor($i / 3)]
    $g.DrawString($stats[$i][0], $fBig, $bSky, $x, $y)
    $g.DrawString($stats[$i][1], $fLabel, $bMuted, $x + 2, $y + 52)
}

# Piede
$g.DrawLine($pen, 80, 540, 1120, 540)
$g.DrawString('patreon.com/c/alessandroevangelisti', $fFoot, $bMuted, 80, 562)
$footer2 = 'github.com/evangelalessandro/HarnessSqlComplete'
$size = $g.MeasureString($footer2, $fFoot)
$g.DrawString($footer2, $fFoot, $bDim, (1120 - $size.Width), 562)

$g.Dispose()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Output "Scritto: $out"
