package com.yiqiu.misakaquiz.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColors = lightColorScheme(
    primary = MisakaColors.BrandPrimary,
    onPrimary = MisakaColors.TextOnBrand,
    secondary = MisakaColors.BrandSecondary,
    background = MisakaColors.BgApp,
    onBackground = MisakaColors.TextPrimary,
    surface = MisakaColors.BgElevated,
    onSurface = MisakaColors.TextPrimary,
    onSurfaceVariant = MisakaColors.TextSecondary,
    outline = MisakaColors.LineSoft
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF89A7FF),
    onPrimary = Color(0xFF0F172A),
    secondary = Color(0xFFB7C8FF),
    background = MisakaColors.BgDeepFocus,
    onBackground = Color(0xFFF8FAFC),
    surface = Color(0xFF13203A),
    onSurface = Color(0xFFF8FAFC),
    onSurfaceVariant = Color(0xFFB8C2D6),
    outline = Color(0x33D7DEEA)
)

@Composable
fun MisakaQuizTheme(
    darkTheme: Boolean = false,
    content: @Composable () -> Unit
) {
    MisakaColors.isDarkMode = darkTheme

    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = MisakaTypography,
        content = content
    )
}
