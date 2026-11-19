// android.view.View and the widgets the verifiers drive. Each instance stands for one
// element of a layout the page inflated from res/layout; state changes are forwarded to it.
package android.view

import android.graphics.drawable.Drawable
import showcase.platform.jsView

open class View(val handle: Int) {
    var isEnabled: Boolean = true
        set(value) { field = value; jsView(handle, "enabled", value.toString()) }

    var visibility: Int = VISIBLE
        set(value) { field = value; jsView(handle, "visibility", value.toString()) }

    val background: Drawable = Drawable(handle)

    private var onClick: ((View) -> Unit)? = null

    fun setOnClickListener(l: (View) -> Unit) { onClick = l }

    fun setBackgroundResource(resid: Int) {
        jsView(handle, "background", com.diches.dichboxmobile.R.drawableName(resid))
    }

    fun performClick(): Boolean { onClick?.invoke(this); return onClick != null }

    companion object {
        const val VISIBLE = 0
        const val GONE = 8
    }
}
