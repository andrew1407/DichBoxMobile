@file:OptIn(kotlin.js.ExperimentalJsExport::class)

package showcase

import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.spansJson
import com.diches.dichboxmobile.api.boxes.BoxesAPI
import com.diches.dichboxmobile.api.user.UserAPI
import com.diches.dichboxmobile.datatypes.BoxesContainer
import com.diches.dichboxmobile.datatypes.UserContainer
import com.diches.dichboxmobile.mv.boxesDataManager.viewStates.OpenedFilesViewModel
import com.diches.dichboxmobile.mv.userDataManager.notifications.NotificationsTypes
import com.diches.dichboxmobile.mv.verifiers.FieldsTemplates
import com.diches.dichboxmobile.mv.verifiers.FieldsWarnings
import com.diches.dichboxmobile.mv.verifiers.editVerifiers.MutableInputVerifier
import com.diches.dichboxmobile.mv.verifiers.editVerifiers.user.UserEditFields
import com.diches.dichboxmobile.mv.verifiers.signVerifiers.SignInVerifier
import com.diches.dichboxmobile.mv.verifiers.signVerifiers.SignUpVerifier
import com.diches.dichboxmobile.tools.AppColors
import com.diches.dichboxmobile.tools.decorateView
import com.diches.dichboxmobile.tools.fillView
import kotlinx.coroutines.runBlocking
import showcase.platform.decodeContainer
import showcase.platform.encodeContainer
import showcase.platform.jsSigned
import kotlin.reflect.KClass

// JS-facing entry points. The page's fragments (web/app.js) call these; everything behind
// them is the app's own code: UserAPI/BoxesAPI over ApiParser and the Retrofit services,
// the UserContainer/BoxesContainer data classes, the verifiers, NotificationsTypes,
// ViewDecorators and OpenedFilesViewModel.

private val userApi by lazy { UserAPI() }
private val boxesApi by lazy { BoxesAPI() }

private class Call(val request: KClass<*>, val run: suspend (Any) -> Pair<Int, Any>)

private val calls: Map<String, Call> = mapOf(
    "search" to Call(UserContainer.SearchedChunk::class) { userApi.search(it as UserContainer.SearchedChunk) },
    "createUser" to Call(UserContainer.SignUp::class) { userApi.createUser(it as UserContainer.SignUp) },
    "removeUser" to Call(UserContainer.RemovedUser::class) { userApi.removeUser(it as UserContainer.RemovedUser) },
    "enterUser" to Call(UserContainer.SignIn::class) { userApi.enterUser(it as UserContainer.SignIn) },
    "findUser" to Call(UserContainer.FindContainer::class) { userApi.findUser(it as UserContainer.FindContainer) },
    "verifyField" to Call(UserContainer.VerifyField::class) { userApi.verifyField(it as UserContainer.VerifyField) },
    "verifyPassword" to Call(UserContainer.VerifyPasswd::class) { userApi.verifyPassword(it as UserContainer.VerifyPasswd) },
    "editUser" to Call(UserContainer.EditData::class) { userApi.editUser(it as UserContainer.EditData) },
    "getSubscriptions" to Call(UserContainer.SignedContainer::class) { userApi.getSubscriptions(it as UserContainer.SignedContainer) },
    "subscribeAction" to Call(UserContainer.SubsAction::class) { userApi.subscribeAction(it as UserContainer.SubsAction) },
    "getNotifications" to Call(UserContainer.SignedContainer::class) { userApi.getNotifications(it as UserContainer.SignedContainer) },
    "removeNotifications" to Call(UserContainer.NotificationsRemoved::class) { userApi.removeNotifications(it as UserContainer.NotificationsRemoved) },
    "getUsernames" to Call(UserContainer.NameListSearch::class) { userApi.getUsernames(it as UserContainer.NameListSearch) },
    "getAccessLists" to Call(UserContainer.AccessListsReq::class) { userApi.getAccessLists(it as UserContainer.AccessListsReq) },
    "getUsernameByUuid" to Call(UserContainer.SignedContainer::class) { userApi.getUsernameByUuid(it as UserContainer.SignedContainer) },
    "getUserBoxes" to Call(BoxesContainer.UserBoxesReq::class) { boxesApi.getUserBoxes(it as BoxesContainer.UserBoxesReq) },
    "verifyBox" to Call(BoxesContainer.VerifyBody::class) { boxesApi.verify(it as BoxesContainer.VerifyBody) },
    "createBox" to Call(BoxesContainer.EditedBoxData::class) { boxesApi.createBox(it as BoxesContainer.EditedBoxData) },
    "getBoxDetails" to Call(BoxesContainer.BoxDetailsReq::class) { boxesApi.getBoxDetails(it as BoxesContainer.BoxDetailsReq) },
    "removeBox" to Call(BoxesContainer.RemoveBoxReq::class) { boxesApi.removeBox(it as BoxesContainer.RemoveBoxReq) },
    "editBox" to Call(BoxesContainer.EditedBoxData::class) { boxesApi.editBox(it as BoxesContainer.EditedBoxData) },
    "getPathFiles" to Call(BoxesContainer.PathEntriesReq::class) { boxesApi.getPathFiles(it as BoxesContainer.PathEntriesReq) },
    "removeFile" to Call(BoxesContainer.FilePropertiesReq::class) { boxesApi.removeFile(it as BoxesContainer.FilePropertiesReq) },
    "renameFile" to Call(BoxesContainer.RenameFileReq::class) { boxesApi.renameFile(it as BoxesContainer.RenameFileReq) },
    "createFile" to Call(BoxesContainer.FilePropertiesReq::class) { boxesApi.createFile(it as BoxesContainer.FilePropertiesReq) },
    "getFileEntries" to Call(BoxesContainer.FilePropertiesReq::class) { boxesApi.getFileEntries(it as BoxesContainer.FilePropertiesReq) },
    "saveFiles" to Call(BoxesContainer.SaveFilesReq::class) { boxesApi.saveFiles(it as BoxesContainer.SaveFilesReq) },
)

/** One UserAPI/BoxesAPI method: the request JSON becomes the app's request container,
 *  the response container comes back as {"status":…,"body":…,"type":"UserData"}. */
@JsExport
fun api(method: String, requestJson: String): String {
    val call = calls[method] ?: error("Unknown API method $method")
    val request = decodeContainer(requestJson, call.request)
    val (status, response) = runBlocking { call.run(request) }
    return """{"status":$status,"type":"${response::class.simpleName}","body":${encodeContainer(response)}}"""
}

// Widgets: each handle is one element of a layout the page inflated from res/layout.

private val views = mutableMapOf<Int, View>()

@Suppress("UNCHECKED_CAST")
private fun <V : View> view(handle: Int, make: (Int) -> V): V = views.getOrPut(handle) { make(handle) } as V

@JsExport
fun viewInput(handle: Int, text: String) { (views[handle] as? TextView)?.userInput(text) }

@JsExport
fun viewClick(handle: Int) { views[handle]?.performClick() }

/** SignIn.onViewCreated: SignInVerifier(submitBtn).checkEmail(…).checkPassword(…). */
@JsExport
fun signInForm(email: Int, emailWarning: Int, password: Int, passwordWarning: Int, submit: Int) {
    SignInVerifier(view(submit, ::Button))
        .checkEmail(view(email, ::EditText), view(emailWarning, ::TextView))
        .checkPassword(view(password, ::EditText), view(passwordWarning, ::TextView))
        .setSaveHandler { name, uuid -> jsSigned(name, uuid) }
}

/** SignUp.onViewCreated: SignUpVerifier(submitBtn).checkUsername(…).checkEmail(…).checkPassword(…). */
@JsExport
fun signUpForm(name: Int, nameWarning: Int, email: Int, emailWarning: Int, password: Int, passwordWarning: Int, submit: Int) {
    SignUpVerifier(view(submit, ::Button))
        .checkUsername(view(name, ::EditText), view(nameWarning, ::TextView))
        .checkEmail(view(email, ::EditText), view(emailWarning, ::TextView))
        .checkPassword(view(password, ::EditText), view(passwordWarning, ::TextView))
        .setSaveHandler { n, uuid -> jsSigned(n, uuid) }
}

/** tools/ViewDecorators.kt fillView(element, text to "#rrggbb"). */
@JsExport
fun fill(handle: Int, text: String, color: String) = fillView(view(handle, ::TextView), Pair(text, color))

/** tools/ViewDecorators.kt decorateView(element, prefix, value to colour); colour is an AppColors name or "#rrggbb". */
@JsExport
fun decorate(handle: Int, prefix: String, value: String, color: String) {
    val raw = if (color.startsWith("#")) android.graphics.Color.parseColor(color) else AppColors.valueOf(color).raw
    decorateView(view(handle, ::TextView), prefix, Pair(value, raw))
}

/** NotificationsAdapter.getView: NotificationsTypes.defineType(type).decorateView(data, msgView). */
@JsExport
fun notificationMessage(dataJson: String): String {
    val data = decodeContainer(dataJson, UserContainer.NotificationData::class) as UserContainer.NotificationData
    val msg = TextView(-1)
    NotificationsTypes.defineType(data.type).decorateView(data, msg)
    return spansJson(msg.text)
}

// Opened files tab: the app's OpenedFilesViewModel holds the tabs.

private val openedFiles = OpenedFilesViewModel()

@JsExport
fun openedFilesCall(op: String, a: String, b: String): String {
    when (op) {
        "add" -> openedFiles.addNewFile(decodeContainer(a, BoxesContainer.OpenedFile::class) as BoxesContainer.OpenedFile)
        "open" -> openedFiles.openFile(a.toInt())
        "close" -> openedFiles.closeFile(a.toInt())
        // FileToolbar.handleEditFields passes the opened file's own name and filePath
        "edit" -> openedFiles.liveData.value?.first { it.opened }?.let { openedFiles.editFile(it.name, it.filePath, a) }
        "viewMode" -> openedFiles.setViewMode()
        "write" -> openedFiles.writeFiles(a == "true")
        "rename" -> openedFiles.renameFile(a.toInt(), b)
        "renamePaths" -> openedFiles.renamePaths(a, b)
        "closeByPath" -> openedFiles.closeByPath(a)
        "clear" -> openedFiles.clear()
    }
    return openedFiles.liveData.value?.joinToString(",", "[", "]") { encodeContainer(it) } ?: "null"
}

// Edit forms. These mirror how UserEditorVerifier, PasswordsVerifier and BoxFormGenerator set
// up the app's MutableInputVerifier/FieldsTemplates/FieldsWarnings (those classes also wire
// colour pickers, image croppers and ShapeDrawables, which stay on the page side).

private var profileVerifier = MutableInputVerifier<UserEditFields>()
private var passwdVerifier = MutableInputVerifier<UserEditFields>()
private var verifiedUser = ""

private suspend fun fieldTaken(field: UserEditFields, value: String): Boolean {
    val (_, res) = userApi.verifyField(UserContainer.VerifyField(field.getVal(), value))
    return (res as UserContainer.VerifyFieldRes).foundValue != null
}

/** UserEditorVerifier init block. */
@JsExport
fun profileVerifierInit(name: String, email: String) {
    verifiedUser = name
    profileVerifier = MutableInputVerifier<UserEditFields>()
        .addVerifier(
            key = UserEditFields.NAME,
            templateWarning = FieldsWarnings.NAME_INVALID.text,
            templateTest = { FieldsTemplates.NAME.test(it) },
            fetchWarning = FieldsWarnings.NAME_TAKEN.text,
            fetchHandler = { if (it == name) true else !fieldTaken(UserEditFields.NAME, it) }
        ).addOmitted(UserEditFields.NAME)
        .addVerifier(
            key = UserEditFields.EMAIL,
            templateWarning = FieldsWarnings.EMAIL_INVALID.text,
            templateTest = { FieldsTemplates.EMAIL.test(it) },
            fetchWarning = FieldsWarnings.EMAIL_TAKEN.text,
            fetchHandler = { if (it == email) true else !fieldTaken(UserEditFields.EMAIL, it) }
        ).addOmitted(UserEditFields.EMAIL)
        .addVerifier(
            key = UserEditFields.DESCRIPTION,
            templateWarning = "",
            templateTest = { true }
        ).addOmitted(UserEditFields.DESCRIPTION)
}

/** UserEditorVerifier.addNameCheck/addEmailCheck/addDescriptionCheck text listeners. */
@JsExport
fun profileVerify(field: String, input: String): String {
    val key = UserEditFields.valueOf(field)
    profileVerifier.removeOmitted(key)
    return runBlocking { profileVerifier.verify(key, input) }
}

@JsExport
fun profileCheckAll(): Boolean = profileVerifier.checkAll()

/** PasswordsVerifier init block (also used when its "cancel" button resets the area). */
@JsExport
fun passwdVerifierInit(username: String) {
    passwdVerifier = MutableInputVerifier<UserEditFields>()
        .addVerifier(
            key = UserEditFields.PASSWD,
            templateWarning = FieldsWarnings.PASSWD_INVALID.text,
            templateTest = { FieldsTemplates.PASSWD.test(it) },
            fetchWarning = FieldsWarnings.PASSWD_INCORRECT.text,
            fetchHandler = {
                val (_, res) = userApi.verifyPassword(UserContainer.VerifyPasswd(username, it))
                (res as UserContainer.VerifyPasswdRes).checked
            }
        ).addOmitted(UserEditFields.PASSWD)
        .addVerifier(
            key = UserEditFields.NEW_PASSWD,
            templateWarning = FieldsWarnings.PASSWD_INVALID.text,
            templateTest = { FieldsTemplates.PASSWD.test(it) }
        ).addOmitted(UserEditFields.NEW_PASSWD)
}

/** PasswordsVerifier.addPasswdCheck/addNewPasswdCheck; returns {"warning":…,"checkAll":…}. */
@JsExport
fun passwdVerify(field: String, input: String): String {
    val key = UserEditFields.valueOf(field)
    passwdVerifier.removeOmitted(key)
    val warning = runBlocking { passwdVerifier.verify(key, input) }
    return """{"warning":${q(warning)},"checkAll":${passwdVerifier.checkAll()}}"""
}

/** BoxFormGenerator.verifyNameInput: {"warning":…,"correct":…}. */
@JsExport
fun boxNameCheck(username: String, input: String): String {
    val nameInvalid =
        "Box name length should be 1-40 symbols (unique, no spaces, \"?\", \"#\", \"%\" or path definitions like: \"../path1/path2/...\")"
    val nameTaken = "You already have a box with the same name"
    val (warning, correct) = when {
        input.isEmpty() -> "" to false
        !FieldsTemplates.NAME.test(input) -> nameInvalid to false
        else -> {
            val (_, res) = runBlocking { boxesApi.verify(BoxesContainer.VerifyBody(username, input)) }
            val (foundValue) = res as BoxesContainer.VerifyRes
            if (foundValue != null) nameTaken to false else "" to true
        }
    }
    return """{"warning":${q(warning)},"correct":$correct}"""
}

/** The field templates themselves, e.g. for the page's "real Kotlin" panel. */
@JsExport
fun templateTest(template: String, input: String): Boolean = FieldsTemplates.valueOf(template).test(input)

private fun q(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

/** Runs app/src/test (InputVerifierTest, MutableInputVerifierTest) and lists every assertion. */
@JsExport
fun unitTests(): String {
    org.junit.Recorder.results.clear()
    org.junit.Recorder.test = "InputVerifierTest"
    com.diches.dichboxmobile.InputVerifierTest().verifiesCorrect()
    org.junit.Recorder.test = "MutableInputVerifierTest"
    com.diches.dichboxmobile.MutableInputVerifierTest().verifiesOmittingCorrect()
    return org.junit.Recorder.results.joinToString(",", "[", "]") {
        """{"test":${q(it.test)},"step":${q(it.step)},"expected":${q(it.expected)},"actual":${q(it.actual)},"pass":${it.pass}}"""
    }
}
