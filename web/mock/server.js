// In-browser imitation of the DichBox API, ported from the DichBox repository's own
// showcase (client/src/demo/mockServer.js), which mirrors the server handlers
// (server/src/controllers) and database triggers (server/src/database/model.sql).
// All state lives in memory, so a page reload restores the initial seed.
import createSeed from './seed.js';

const Statuses = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SERVER_INTERNAL: 500
};

const ErrorMessages = {
  USER_INVAID_REQUEST: 'This data is toxic. Not good for you...',
  USER_NOT_FOUND: 'The searched digital twin wasn\'t found in the DichBox system...',
  FORBIDDEN: 'Forbidden for you!!!',
  SUBSCRIPTIONS_NOT_FOUND: 'Nothing was found for you...',
  BOXES_NOT_FOUND: 'No box, no files, no directories... Nothing... Just nothing...',
  BOXES_INVAID_REQUEST: 'Well, invalid data...',
  DIR_NOT_FOUND: 'Nothing is here. No files, no directories...',
  INVALID_PATH: 'This path has led you to nowhere...',
  BOXES_INTERNAL: 'Very big problems with the DichBox server.',
  FILES_NOT_FOUND: 'Wrong names, no data for you...',
  SERVER_INTERNAL: 'It\'s a secret, but something terrible happened on the DichBox server...',
  INVALID_PASSWORD: 'Invalid password'
};

const patterns = {
  name: /^[^#%\?\s/]{1,40}$/,
  passwd: /^[\S]{5,20}$/,
  email: /^([a-z_\d\.-]+)@([a-z\d]+)\.([a-z]{2,8})(\.[a-z]{2,8})*$/,
  color: /^#[a-z\d]{6}$/
};

let db = null;

// The seed embeds images as data URLs, which are read from the app's resources first.
export const initMock = async () => { db = await createSeed(); };

// helpers

const tuple = (status, json) => [status, json];
const now = () => new Date().toISOString();
const clone = obj => JSON.parse(JSON.stringify(obj));

const justifyNumber = n => (n.length > 1 ? n : '0' + n);
const transformDate = (date, separator, joiner) => date
  .split(separator)
  .map(justifyNumber)
  .join(joiner);
const formatDate = dateRaw => transformDate(
  new Date(dateRaw).toLocaleDateString('en-US'), '/', '.'
);
const formatDateTime = dateRaw => {
  const [yearRaw, timeRaw] = new Date(dateRaw)
    .toLocaleString('en-US')
    .split(', ');
  return `${transformDate(yearRaw, '/', '.')}, ${transformDate(timeRaw, ':', ':')}`;
};

const checkInvalidPath = dirPath => {
  if (/^(\.)+$/.test(dirPath)) return true;
  return /((\/)|((\/)(\.)+)|((\.)+)(\/))/.test(dirPath);
};
const checkPathes = pathes => pathes.every(p => p.every(dir => !checkInvalidPath(dir)));

const isString = x => typeof x === 'string';
const checkFields = (data, specific = {}) => {
  const fieldsCheck = {
    ...specific,
    name: x => isString(x) && patterns.name.test(x),
    name_color: x => isString(x) && patterns.color.test(x),
    description: x => isString(x) && x.length <= 100,
    description_color: x => isString(x) && patterns.color.test(x)
  };
  return Object.keys(data).every(key => !(key in fieldsCheck) || fieldsCheck[key](data[key]));
};
const checkUserEdited = data => checkFields(data, {
  email: x => patterns.email.test(x),
  passwd: x => patterns.passwd.test(x)
});
const checkBoxEdited = data => checkFields(data, {
  access_level: x => isString(x) && /^(public|private|followers|limited)$/.test(x)
});

const nextId = table => db.ids[table] = (db.ids[table] || 0) + 1;

// users

const userByName = name => db.users.find(u => u.name === name) || null;
const userById = id => db.users.find(u => u.id === id) || null;
const userId = name => userByName(name)?.id || null;
const userLogo = id => userById(id)?.logo || null;

const foundUserMapper = u => ({ name: u.name, name_color: u.name_color, logo: u.logo || null });

const isFollower = (person_id, subscription) => db.subscribers
  .some(s => s.person_id === person_id && s.subscription === subscription);

const notify = (person_id, type, param = -1, extra_values = null) => {
  db.notifications.push({
    id: nextId('notifications'),
    person_id,
    type,
    param,
    extra_values,
    note_date: now()
  });
};

const removeUserCascade = user => {
  // rm_user_subs trigger
  for (const s of db.subscribers.filter(s => s.subscription === user.id))
    notify(s.person_id, 'userRm', -1, [user.name, user.name_color]);
  for (const s of db.subscribers.filter(s => s.person_id === user.id)) {
    const sub = userById(s.subscription);
    if (sub) sub.followers--;
  }
  const ownBoxes = db.boxes.filter(b => b.owner_id === user.id).map(b => b.id);
  const boxMsg = /^((viewer|editor)(Add|Rm)|boxAdd)$/;
  db.notifications = db.notifications.filter(n =>
    n.person_id !== user.id && !(boxMsg.test(n.type) && ownBoxes.includes(n.param))
  );
  db.subscribers = db.subscribers.filter(s => s.person_id !== user.id && s.subscription !== user.id);
  db.limited = db.limited.filter(x => x.person_id !== user.id && !ownBoxes.includes(x.box_id));
  db.editors = db.editors.filter(x => x.person_id !== user.id && !ownBoxes.includes(x.box_id));
  db.boxes = db.boxes.filter(b => b.owner_id !== user.id);
  for (const id of ownBoxes) delete db.storage[id];
  db.users = db.users.filter(u => u !== user);
};

// boxes

const boxOf = (ownerName, boxName) => {
  const owner_id = userId(ownerName);
  return db.boxes.find(b => b.owner_id === owner_id && b.name === boxName) || null;
};

const isEditor = (box_id, person_id) => db.editors
  .some(x => x.box_id === box_id && x.person_id === person_id);
const isLimitedViewer = (box_id, person_id) => db.limited
  .some(x => x.box_id === box_id && x.person_id === person_id);

const canView = (box, viewer_id) => {
  if (!box) return false;
  if (box.owner_id === viewer_id || isEditor(box.id, viewer_id)) return true;
  switch (box.access_level) {
    case 'public': return true;
    case 'followers': return !!viewer_id && isFollower(viewer_id, box.owner_id);
    case 'limited': return !!viewer_id && isLimitedViewer(box.id, viewer_id);
    default: return false;
  }
};

const checkBoxAccess = (ownerName, viewerName, boxName) => {
  const box = boxOf(ownerName, boxName);
  return canView(box, userId(viewerName)) ? box : null;
};

const boxListItem = (box, access_level = box.access_level) => ({
  owner_name: userById(box.owner_id).name,
  name: box.name,
  name_color: box.name_color,
  access_level
});

const byLastEdited = (a, b) => b.last_edited.localeCompare(a.last_edited);

const setAccessList = (table, box, names, addType, rmType) => {
  const ids = names.map(userId).filter(Boolean);
  const current = db[table].filter(x => x.box_id === box.id);
  for (const x of current)
    if (!ids.includes(x.person_id)) notify(x.person_id, rmType, box.id);
  for (const id of ids)
    if (!current.some(x => x.person_id === id)) notify(id, addType, box.id);
  db[table] = db[table]
    .filter(x => x.box_id !== box.id)
    .concat(ids.map(person_id => ({ box_id: box.id, person_id })));
};
const setLimited = (box, names) => setAccessList('limited', box, names, 'viewerAdd', 'viewerRm');
const setEditors = (box, names) => setAccessList('editors', box, names, 'editorAdd', 'editorRm');

const touchBox = box => {
  box.last_edited = now();
  return formatDateTime(box.last_edited);
};

// storage

const imageExp = /\.(png|jpeg|jpg|webp|tiff|raw|gif|bmp)$/;
const entryType = (name, node) => node.type === 'dir' ? 'dir' :
  imageExp.test(name) ? 'image' : 'file';

const resolveNode = (box, extraPath) => {
  let node = db.storage[box.id];
  for (const p of extraPath) {
    if (!node || node.type !== 'dir') return null;
    node = node.children[p];
  }
  return node || null;
};

const dirEntries = dir => Object.keys(dir.children)
  .sort()
  .map(name => ({ name, type: entryType(name, dir.children[name]) }));

// handlers

const users = {
  identify({ uuid }) {
    const msg = ErrorMessages.USER_NOT_FOUND;
    if (!uuid) return tuple(Statuses.NOT_FOUND, { msg });
    const user = db.users.find(u => u.user_uid === uuid);
    return user ?
      tuple(Statuses.OK, { name: user.name }) :
      tuple(Statuses.NOT_FOUND, { msg });
  },

  create(data) {
    const valid = data && ['name', 'email', 'passwd']
      .every(k => isString(data[k]) && patterns[k].test(data[k])) &&
      checkUserEdited(data);
    const taken = valid && db.users.some(u => u.name === data.name || u.email === data.email);
    if (!valid || taken)
      return tuple(Statuses.BAD_REQUEST, { msg: ErrorMessages.USER_INVAID_REQUEST });
    const user = {
      id: nextId('users'),
      name: data.name,
      name_color: data.name_color || '#00d9ff',
      email: data.email,
      passwd: data.passwd,
      followers: 0,
      reg_date: now(),
      description: data.description || '',
      description_color: data.description_color || '#00d9ff',
      user_uid: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2),
      logo: null
    };
    db.users.push(user);
    notify(user.id, 'helloMsg');
    return tuple(Statuses.CREATED, { name: user.name, user_uid: user.user_uid });
  },

  find({ pathName, username }) {
    const ownPage = pathName === username;
    const user = userByName(pathName);
    if (!user) return tuple(Statuses.NOT_FOUND, { msg: ErrorMessages.USER_NOT_FOUND });
    const { id, passwd, user_uid, logo, ...rest } = user;
    const res = {
      ...rest,
      reg_date: formatDate(user.reg_date),
      notifications: db.notifications.filter(n => n.person_id === id).length,
      logo: logo || null,
      follower: false
    };
    if (!ownPage) {
      delete res.email;
      res.follower = isFollower(userId(username), id);
    }
    return tuple(Statuses.OK, { ...res, ownPage });
  },

  enter({ email, passwd }) {
    const user = db.users.find(u => u.email === email);
    if (!user) return tuple(Statuses.NOT_FOUND, { msg: ErrorMessages.USER_NOT_FOUND });
    if (user.passwd !== passwd)
      return tuple(Statuses.BAD_REQUEST, { msg: ErrorMessages.INVALID_PASSWORD });
    return tuple(Statuses.OK, { name: user.name, user_uid: user.user_uid });
  },

  verify({ inputField, inputValue }) {
    const user = db.users.find(u => u[inputField] === inputValue);
    return tuple(Statuses.OK, { foundValue: user ? user[inputField] : null });
  },

  passwd_verify({ username, passwd }) {
    const user = userByName(username);
    return tuple(Statuses.OK, { checked: !!user && user.passwd === passwd });
  },

  edit({ username, edited, logo }) {
    const user = userByName(username);
    if (!user) return tuple(Statuses.BAD_REQUEST, { msg: ErrorMessages.USER_INVAID_REQUEST });
    const res = {};
    if (edited && Object.keys(edited).length) {
      const taken = (edited.name || edited.email) && db.users.some(u =>
        u.name === (edited.name || '') || u.email === (edited.email || '')
      );
      if (!checkUserEdited(edited) || taken)
        return tuple(Statuses.BAD_REQUEST, { msg: ErrorMessages.USER_INVAID_REQUEST });
      Object.assign(user, edited);
      Object.assign(res, edited);
      delete res.passwd;
    }
    if (logo) {
      user.logo = logo === 'removed' ? null : logo;
      res.logo = user.logo;
    }
    return tuple(Statuses.OK, res);
  },

  remove({ uuid, confirmation }) {
    const msg = ErrorMessages.FORBIDDEN;
    const user = db.users.find(u => u.user_uid === uuid);
    if (!user || confirmation !== 'permitted') return tuple(Statuses.FORBIDDEN, { msg });
    removeUserCascade(user);
    return tuple(Statuses.OK, { removed: true });
  },

  names_list({ nameTemplate, username }) {
    if (!(isString(nameTemplate) && isString(username)))
      return tuple(Statuses.OK, { msg: ErrorMessages.USER_INVAID_REQUEST });
    const template = nameTemplate.toLowerCase();
    const foundUsers = db.users
      .filter(u => u.name !== username && u.name.toLowerCase().includes(template))
      .slice(0, 10)
      .map(foundUserMapper);
    return tuple(Statuses.OK, { foundUsers });
  },

  access_lists({ username, boxName }) {
    const box = boxOf(username, boxName);
    const list = table => !box ? [] : db[table]
      .filter(x => x.box_id === box.id)
      .map(x => foundUserMapper(userById(x.person_id)));
    return tuple(Statuses.OK, { limitedUsers: list('limited'), editors: list('editors') });
  },

  subscription({ action, personName, subscriptionName, responseValues }) {
    if (personName === subscriptionName)
      return tuple(Statuses.BAD_REQUEST, { msg: ErrorMessages.USER_INVAID_REQUEST });
    const person = userByName(personName);
    const subscription = userByName(subscriptionName);
    if (!(person && subscription))
      return tuple(Statuses.NOT_FOUND, { msg: ErrorMessages.SUBSCRIPTIONS_NOT_FOUND });
    const subscribe = action === 'subscribe';
    const following = isFollower(person.id, subscription.id);
    if (subscribe && !following) {
      db.subscribers.push({ person_id: person.id, subscription: subscription.id });
      subscription.followers++;
    } else if (!subscribe && following) {
      db.subscribers = db.subscribers.filter(s =>
        !(s.person_id === person.id && s.subscription === subscription.id)
      );
      subscription.followers--;
    }
    if (!responseValues) return tuple(Statuses.OK, { unsubscribed: !subscribe });
    return tuple(Statuses.OK, { followers: subscription.followers, follower: subscribe });
  },

  subs_list({ name }) {
    const user = userByName(name);
    if (!user) return tuple(Statuses.NOT_FOUND, { msg: ErrorMessages.USER_NOT_FOUND });
    const subs = db.subscribers
      .filter(s => s.person_id === user.id)
      .map(s => foundUserMapper(userById(s.subscription)))
      .reverse();
    return tuple(Statuses.OK, { subs });
  },

  search({ searchStr }) {
    if (!isString(searchStr))
      return tuple(Statuses.BAD_REQUEST, { msg: ErrorMessages.USER_INVAID_REQUEST });
    const search = Array.from(searchStr).filter(ch => /\S/.test(ch)).join('').toLowerCase();
    const searched = db.users
      .filter(u => u.name.toLowerCase().includes(search))
      .sort((a, b) => b.followers - a.followers)
      .slice(0, 26)
      .map(foundUserMapper);
    return tuple(Statuses.OK, { searched });
  },

  notifications_list({ name }) {
    const user = userByName(name);
    const listMsg = /^((viewer|editor)(Add|Rm))$/;
    const notifications = !user ? [] : db.notifications
      .filter(n => n.person_id === user.id)
      .map(n => {
        const base = { id: n.id, type: n.type, note_date: formatDateTime(n.note_date) };
        const box = db.boxes.find(b => b.id === n.param);
        if ((listMsg.test(n.type) || n.type === 'boxAdd') && box) {
          const owner = userById(box.owner_id);
          const msgEntries = [];
          if (n.type === 'boxAdd') {
            msgEntries.push('User', 'has created a new box:');
          } else {
            let msgStr = 'has';
            msgStr += n.type.endsWith('Add') ? ' added you to the ' : ' removed you from the ';
            msgStr += n.type.startsWith('viewer') ? 'viewer' : 'editor';
            msgStr += 's\' list in';
            msgEntries.push('User', msgStr, 'box');
          }
          return {
            ...base,
            box_name: box.name,
            box_color: box.name_color,
            user_name: owner.name,
            user_color: owner.name_color,
            msgEntries,
            icon: owner.logo || null
          };
        }
        if (n.type === 'userRm') {
          const [user_name, user_color] = n.extra_values;
          return {
            ...base,
            user_name,
            user_color,
            msgEntries: ['The account you followed', 'has been removed'],
            icon: null
          };
        }
        const helloMsg = 'Welcome to "DichBox" world. You need to know nothing, just start creating boxes, editing your profile, searching other users etc. Good luck!';
        return { ...base, msgEntries: [helloMsg], icon: null };
      });
    return tuple(Statuses.OK, { notifications });
  },

  notifications_remove({ username, ntsIds }) {
    const id = userId(username);
    if (!(id && ntsIds?.length)) return tuple(Statuses.OK, { removed: false });
    db.notifications = db.notifications.filter(n => !(n.person_id === id && ntsIds.includes(n.id)));
    return tuple(Statuses.OK, { removed: true });
  }
};

const boxes = {
  create({ boxData, logo, limitedUsers, editors, username }) {
    const owner = userByName(username);
    const valid = owner && boxData && isString(boxData.name) &&
      patterns.name.test(boxData.name) && checkBoxEdited(boxData) &&
      !boxOf(username, boxData.name);
    if (!valid) return tuple(Statuses.SERVER_INTERNAL, { msg: ErrorMessages.SERVER_INTERNAL });
    const date = now();
    const box = {
      id: nextId('boxes'),
      name: boxData.name,
      name_color: boxData.name_color || '#00d9ff',
      owner_id: owner.id,
      access_level: boxData.access_level,
      description: boxData.description || '',
      description_color: boxData.description_color || '#00d9ff',
      reg_date: date,
      last_edited: date,
      logo: logo || null
    };
    db.boxes.push(box);
    db.storage[box.id] = { type: 'dir', children: {} };
    // notify_box_add trigger
    if (box.access_level === 'public' || box.access_level === 'followers')
      for (const s of db.subscribers.filter(s => s.subscription === owner.id))
        notify(s.person_id, 'boxAdd', box.id);
    if (limitedUsers?.length) setLimited(box, limitedUsers);
    if (editors?.length) setEditors(box, editors);
    return tuple(Statuses.CREATED, { name: box.name });
  },

  user_boxes({ viewerName, boxOwnerName }) {
    if (!boxOwnerName)
      return tuple(Statuses.BAD_REQUEST, { msg: ErrorMessages.BOXES_INVAID_REQUEST });
    const owner_id = userId(boxOwnerName);
    const viewer_id = userId(viewerName || null);
    let boxesList;
    if (viewerName === boxOwnerName) {
      const own = db.boxes.filter(b => b.owner_id === owner_id).sort(byLastEdited);
      const invetee = db.boxes
        .filter(b => isEditor(b.id, owner_id))
        .sort(byLastEdited);
      boxesList = own.map(b => boxListItem(b))
        .concat(invetee.map(b => boxListItem(b, 'invetee')));
    } else {
      const follower = !!viewer_id && isFollower(viewer_id, owner_id);
      const visible = db.boxes
        .filter(b => b.owner_id === owner_id &&
          (b.access_level === 'public' || (follower && b.access_level === 'followers')))
        .sort(byLastEdited);
      const limited = db.boxes
        .filter(b => b.owner_id === owner_id && isLimitedViewer(b.id, viewer_id))
        .sort(byLastEdited);
      boxesList = visible.concat(limited).map(b => boxListItem(b));
    }
    return tuple(Statuses.OK, { boxesList });
  },

  verify({ username, boxName }) {
    return tuple(Statuses.OK, { foundValue: boxOf(username, boxName)?.name || null });
  },

  details({ ownerName, viewerName, boxName }) {
    const box = boxOf(ownerName, boxName);
    const viewer_id = userId(viewerName || null);
    if (!canView(box, viewer_id))
      return tuple(Statuses.NOT_FOUND, { msg: ErrorMessages.BOXES_NOT_FOUND });
    const owner = userById(box.owner_id);
    return tuple(Statuses.OK, {
      name: box.name,
      name_color: box.name_color,
      owner_name: owner.name,
      owner_nc: owner.name_color,
      reg_date: formatDateTime(box.reg_date),
      last_edited: formatDateTime(box.last_edited),
      description: box.description,
      description_color: box.description_color,
      access_level: box.access_level,
      editor: ownerName === viewerName || isEditor(box.id, viewer_id),
      logo: box.logo || null
    });
  },

  edit({ username, logo, limitedUsers, editors, boxData, boxName }) {
    const box = boxOf(username, boxName);
    const renamedTaken = boxData?.name && boxData.name !== boxName && boxOf(username, boxData.name);
    if (!box || (boxData && !checkBoxEdited(boxData)) || renamedTaken)
      return tuple(Statuses.BAD_REQUEST, { msg: ErrorMessages.BOXES_INVAID_REQUEST });
    const wasLimited = box.access_level === 'limited';
    if (boxData) Object.assign(box, boxData);
    box.last_edited = now();
    if (editors) setEditors(box, editors);
    const isLimited = box.access_level === 'limited';
    if (wasLimited && !isLimited) setLimited(box, []);
    else if (isLimited && limitedUsers) setLimited(box, limitedUsers);
    if (logo) box.logo = logo === 'removed' ? null : logo;
    const res = {
      ...(boxData || {}),
      access_level: box.access_level,
      last_edited: formatDateTime(box.last_edited)
    };
    if (logo && logo !== 'removed') res.logo = logo;
    return tuple(Statuses.OK, res);
  },

  remove({ confirmation, username, boxName, ownPage }) {
    const msg = ErrorMessages.FORBIDDEN;
    if (!ownPage || confirmation !== 'permitted') return tuple(Statuses.FORBIDDEN, { msg });
    const box = boxOf(username, boxName);
    if (!box) return tuple(Statuses.FORBIDDEN, { msg });
    // box_msgs_rm trigger + cascades
    const boxMsg = /^((viewer|editor)(Add|Rm)|boxAdd)$/;
    db.notifications = db.notifications.filter(n => !(boxMsg.test(n.type) && n.param === box.id));
    db.limited = db.limited.filter(x => x.box_id !== box.id);
    db.editors = db.editors.filter(x => x.box_id !== box.id);
    db.boxes = db.boxes.filter(b => b !== box);
    delete db.storage[box.id];
    return tuple(Statuses.OK, { removed: true });
  },

  'files/list'({ boxPath, viewerName, initial }) {
    const [ownerName, boxName, ...extraPath] = boxPath;
    const msg = ErrorMessages.DIR_NOT_FOUND;
    if (!checkPathes([extraPath])) return tuple(Statuses.NOT_FOUND, { msg });
    const box = checkBoxAccess(ownerName, viewerName || null, boxName);
    const node = box && resolveNode(box, extraPath);
    if (!node) return tuple(Statuses.NOT_FOUND, { msg });
    if (node.type === 'dir') {
      const name = extraPath.length > 1 ? extraPath[extraPath.length - 1] : 'root';
      return tuple(Statuses.OK, { entries: { type: 'dir', dir: { src: dirEntries(node), name } } });
    }
    if (initial) return tuple(Statuses.NOT_FOUND, { msg });
    const name = extraPath[extraPath.length - 1];
    return tuple(Statuses.OK, { entries: { type: 'file', file: { src: node.content, name } } });
  },

  'files/create'({ boxPath, viewerName, fileName, type, src }) {
    const [ownerName, boxName, ...extraPath] = boxPath;
    if (!checkPathes([extraPath]))
      return tuple(Statuses.NOT_FOUND, { msg: ErrorMessages.INVALID_PATH });
    const box = checkBoxAccess(ownerName, viewerName, boxName);
    const dir = box && resolveNode(box, extraPath);
    const validName = isString(fileName) && patterns.name.test(fileName);
    if (!['dir', 'file', 'image'].includes(type) || !validName)
      return tuple(Statuses.BAD_REQUEST, { msg: ErrorMessages.BOXES_INVAID_REQUEST });
    // existing entries are never overwritten (a folder would lose its whole subtree)
    if (!dir || dir.type !== 'dir' || dir.children[fileName])
      return tuple(Statuses.SERVER_INTERNAL, { msg: ErrorMessages.SERVER_INTERNAL });
    dir.children[fileName] = type === 'dir' ?
      { type: 'dir', children: {} } :
      { type: 'file', content: type === 'image' ? (src || '') : '' };
    const last_edited = touchBox(box);
    const typeKey = type === 'dir' ? 'dir' : 'file';
    const created = { type, [typeKey]: { src: dirEntries(dir), name: fileName } };
    return tuple(Statuses.CREATED, { created, last_edited });
  },

  'files/get'({ boxPath, viewerName, fileName, type }) {
    const [ownerName, boxName, ...extraPath] = boxPath;
    const msg = ErrorMessages.INVALID_PATH;
    if (!checkPathes([extraPath])) return tuple(Statuses.NOT_FOUND, { msg });
    const box = checkBoxAccess(ownerName, viewerName || null, boxName);
    if (!box || type === 'dir') return tuple(Statuses.NOT_FOUND, { msg });
    const node = resolveNode(box, [...extraPath, fileName]);
    if (!node || node.type === 'dir') return tuple(Statuses.NOT_FOUND, { msg });
    return tuple(Statuses.OK, { foundData: node.content, found: true });
  },

  'files/save'({ editorName, files }) {
    if (!files?.length)
      return tuple(Statuses.FORBIDDEN, { msg: ErrorMessages.BOXES_INVAID_REQUEST });
    const editor_id = userId(editorName);
    if (!editor_id) return tuple(Statuses.FORBIDDEN, { msg: ErrorMessages.FORBIDDEN });
    const formatted = files.map(f => ({ src: f.src, filePath: f.filePathStr.split('/').splice(1) }));
    if (!checkPathes(formatted.map(f => f.filePath)))
      return tuple(Statuses.FORBIDDEN, { msg: ErrorMessages.FORBIDDEN });
    const [ownerName, boxName] = formatted[0].filePath;
    const box = checkBoxAccess(ownerName, editorName, boxName);
    if (!box) return tuple(Statuses.FORBIDDEN, { msg: ErrorMessages.FORBIDDEN });
    const nodes = formatted.map(f => resolveNode(box, f.filePath.slice(2)));
    if (nodes.some(n => !n || n.type === 'dir'))
      return tuple(Statuses.SERVER_INTERNAL, { msg: ErrorMessages.BOXES_INTERNAL });
    nodes.forEach((n, i) => { n.content = formatted[i].src; });
    return tuple(Statuses.OK, { edited: true, last_edited: touchBox(box) });
  },

  'files/remove'({ boxPath, viewerName, fileName }) {
    const [ownerName, boxName, ...extraPath] = boxPath;
    const msg = ErrorMessages.INVALID_PATH;
    if (!checkPathes([extraPath])) return tuple(Statuses.NOT_FOUND, { msg });
    const box = checkBoxAccess(ownerName, viewerName, boxName);
    if (!box) return tuple(Statuses.NOT_FOUND, { msg });
    const dir = resolveNode(box, extraPath);
    if (!dir || dir.type !== 'dir' || !dir.children[fileName])
      return tuple(Statuses.SERVER_INTERNAL, { msg: ErrorMessages.BOXES_INTERNAL });
    delete dir.children[fileName];
    return tuple(Statuses.OK, { removed: true, last_edited: touchBox(box) });
  },

  'files/rename'({ boxPath, viewerName, fileName, newName }) {
    const [ownerName, boxName, ...extraPath] = boxPath;
    const msg = ErrorMessages.FILES_NOT_FOUND;
    if (!checkPathes([extraPath])) return tuple(Statuses.NOT_FOUND, { msg });
    const box = checkBoxAccess(ownerName, viewerName, boxName);
    if (!box) return tuple(Statuses.NOT_FOUND, { msg });
    const dir = resolveNode(box, extraPath);
    // an existing sibling with the target name is never replaced
    const renamed = !!dir && dir.type === 'dir' && !!dir.children[fileName] &&
      isString(newName) && patterns.name.test(newName) &&
      newName !== fileName && !dir.children[newName];
    if (!renamed)
      return tuple(Statuses.OK, { renamed, last_edited: formatDateTime(box.last_edited) });
    dir.children[newName] = dir.children[fileName];
    delete dir.children[fileName];
    return tuple(Statuses.OK, { renamed, last_edited: touchBox(box) });
  }
};

const routes = { users, boxes };

// Resolves "<anything>/users/find" -> users.find(body)
export const handleRequest = (url, body) => {
  const match = /\/(users|boxes)\/(.+)$/.exec(url);
  const handler = match && routes[match[1]][match[2]];
  if (!handler) return tuple(Statuses.NOT_FOUND, { msg: ErrorMessages.SERVER_INTERNAL });
  try {
    const [status, json] = handler(clone(body || {}));
    return [status, clone(json)];
  } catch (e) {
    console.error('[DichBox demo]', e);
    return tuple(Statuses.SERVER_INTERNAL, { msg: ErrorMessages.SERVER_INTERNAL });
  }
};

export const demoUser = () => db.users.find(u => u.id === db.loggedInId);
export const demoCredentials = () => db.users.map(({ name, email, passwd }) => ({ name, email, passwd }));
