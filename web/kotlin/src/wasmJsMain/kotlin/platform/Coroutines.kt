// The subset of kotlinx.coroutines the app's verifiers use. Every suspend call in the
// compiled code ends in the synchronous in-browser API mock, so nothing ever really
// suspends: launch/withContext/runBlocking just run the block to completion.
package kotlinx.coroutines

import kotlin.coroutines.Continuation
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.coroutines.startCoroutine

interface CoroutineScope

private object Scope : CoroutineScope

object Dispatchers {
    val Main: CoroutineContext = EmptyCoroutineContext
    val IO: CoroutineContext = EmptyCoroutineContext
}

@Suppress("FunctionName", "UNUSED_PARAMETER")
fun CoroutineScope(context: CoroutineContext): CoroutineScope = Scope

fun CoroutineScope.launch(block: suspend CoroutineScope.() -> Unit) {
    block.startCoroutine(this, Continuation(EmptyCoroutineContext) { it.getOrThrow() })
}

@Suppress("UNUSED_PARAMETER")
suspend fun <T> withContext(context: CoroutineContext, block: suspend CoroutineScope.() -> T): T = Scope.block()

@Suppress("UNUSED_PARAMETER")
fun <T> runBlocking(context: CoroutineContext = EmptyCoroutineContext, block: suspend CoroutineScope.() -> T): T {
    var result: Result<T>? = null
    block.startCoroutine(Scope, Continuation(EmptyCoroutineContext) { result = it })
    return result!!.getOrThrow()
}
