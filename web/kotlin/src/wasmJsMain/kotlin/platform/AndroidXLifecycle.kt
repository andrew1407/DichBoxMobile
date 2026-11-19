// androidx.lifecycle as OpenedFilesViewModel.kt uses it (no observers needed here:
// the page reads the value after every call).
package androidx.lifecycle

open class ViewModel

open class LiveData<T> {
    internal var stored: T? = null
    open val value: T? get() = stored
}

class MutableLiveData<T> : LiveData<T>() {
    override var value: T?
        get() = stored
        set(v) { stored = v }
}
