package com.yiqiu.misakaquiz.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.yiqiu.misakaquiz.ui.components.ActionPillButton
import com.yiqiu.misakaquiz.ui.components.GlassCard
import com.yiqiu.misakaquiz.ui.components.MisakaHeader
import com.yiqiu.misakaquiz.ui.theme.MisakaSpacing

@Composable
fun AboutScreen(
    onBack: () -> Unit
) {
    val uriHandler = LocalUriHandler.current

    Column(
        modifier = Modifier
            .verticalScroll(rememberScrollState())
            .padding(horizontal = MisakaSpacing.Xl, vertical = MisakaSpacing.Sm),
        verticalArrangement = Arrangement.spacedBy(MisakaSpacing.Lg)
    ) {
        MisakaHeader(
            kicker = "About",
            title = "关于 Misaka Quiz",
            subtitle = "我是 Misaka，欢迎关注。"
        )

        GlassCard {
            Text(
                text = "项目地址",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = "https://github.com/reiqr/misaka-quiz",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(Modifier.height(10.dp))
            ActionPillButton(
                icon = Icons.AutoMirrored.Rounded.ArrowBack,
                text = "打开 GitHub 项目页",
                primary = true,
                modifier = Modifier.height(42.dp),
                onClick = { uriHandler.openUri("https://github.com/reiqr/misaka-quiz") }
            )
        }

        GlassCard {
            Text(
                text = "项目说明",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = "Misaka Quiz 是一个面向本地题库导入、练习、考试、错题复习和学习记录管理的刷题工具。原生安卓版本重点优化移动端操作体验、题库核对和本地数据管理。",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        GlassCard {
            Text(
                text = "开源与数据",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = "题库、错题本和学习记录默认保存在本机。发布包不应包含用户本地导入数据。",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        ActionPillButton(
            icon = Icons.AutoMirrored.Rounded.ArrowBack,
            text = "返回设置",
            primary = false,
            modifier = Modifier.height(42.dp),
            onClick = onBack
        )
    }
}
