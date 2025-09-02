import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, signInWithCustomToken, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, getDocs, setDoc } from 'firebase/firestore';

// --- Firebase Configuration & Initialization ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseApp = Object.keys(firebaseConfig).length > 0 ? initializeApp(firebaseConfig) : null;
const auth = firebaseApp ? getAuth(firebaseApp) : null;
const db = firebaseApp ? getFirestore(firebaseApp) : null;

// --- Ripple Effect CSS Class ---
// This is a CSS class to be applied to buttons to add a ripple effect on click.
// It's defined here in the JS file for the single-file mandate.
const rippleEffectCss = `
  .ripple-button {
    position: relative;
    overflow: hidden;
    transform: translate3d(0, 0, 0);
  }
  .ripple-button:after {
    content: '';
    display: block;
    position: absolute;
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
    pointer-events: none;
    background-image: radial-gradient(circle, #fff 10%, transparent 10.01%);
    background-repeat: no-repeat;
    background-position: 50%;
    transform: scale(10, 10);
    opacity: 0;
    transition: transform .5s, opacity 1s;
  }
  .ripple-button:active:after {
    transform: scale(0, 0);
    opacity: 0.3;
    transition: 0s;
  }
`;

// --- The Main App Component ---
export default function App() {
  const [user, setUser] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [posts, setPosts] = useState([]);
  const [postContent, setPostContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [modalMessage, setModalMessage] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // --- Utility Functions ---
  const showModal = (message) => {
    setModalMessage(message);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setModalMessage('');
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Just now';
    const date = timestamp.toDate();
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  // --- Auth Handlers ---
  const handleGoogleSignIn = async () => {
    try {
      if (!auth) {
        showModal('Firebase Auth is not initialized.');
        return;
      }
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // Check for existing user document or create a new one
      const userRef = doc(db, `/artifacts/${appId}/public/data/users`, user.uid);
      const userSnap = await getDocs(query(collection(db, `/artifacts/${appId}/public/data/users`), where('uid', '==', user.uid)));
      if (userSnap.empty) {
        await setDoc(userRef, {
          uid: user.uid,
          displayName: user.displayName,
          isBanned: false,
          createdAt: new Date(),
        });
      }

    } catch (error) {
      console.error('Google Sign-In Error:', error);
      showModal('Failed to sign in with Google. Check the console for details.');
    }
  };

  const handleSignOut = async () => {
    if (auth) {
      await signOut(auth);
      setUser(null);
      showModal('You have been signed out.');
    }
  };

  // --- Firebase Initialization and Auth State Listener ---
  useEffect(() => {
    if (!firebaseApp || !auth || !db) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        let userDoc;
        try {
          // Check for existing user document and its ban status
          const q = query(collection(db, `/artifacts/${appId}/public/data/users`), where('uid', '==', currentUser.uid));
          const querySnapshot = await getDocs(q);
          if (!querySnapshot.empty) {
            userDoc = querySnapshot.docs[0].data();
            if (userDoc.isBanned) {
              await signOut(auth);
              showModal('Your account has been banned. You have been signed out.');
              setUser(null);
            } else {
              setUser({ ...currentUser, displayName: userDoc.displayName });
            }
          } else {
            // New user, create their document
            await setDoc(doc(db, `/artifacts/${appId}/public/data/users`, currentUser.uid), {
              uid: currentUser.uid,
              displayName: currentUser.displayName,
              isBanned: false,
              createdAt: new Date(),
            });
            setUser(currentUser);
          }
        } catch (error) {
          console.error("Error fetching user data:", error);
          showModal("Error fetching user data. Please try again.");
          setUser(null);
        }
      } else {
        setUser(null);
      }
      setIsAuthReady(true);
      setLoading(false);
    });

    // Handle initial custom token sign-in
    const handleInitialAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && auth) {
        try {
          await signInWithCustomToken(auth, __initial_auth_token);
        } catch (error) {
          console.error("Initial custom token sign-in failed:", error);
          await signInAnonymously(auth);
        }
      } else if (auth) {
        await signInAnonymously(auth);
      }
    };

    handleInitialAuth();

    return () => unsubscribe();
  }, [firebaseApp, auth, db]);


  // --- Firestore Listeners for Posts and Comments ---
  useEffect(() => {
    if (!db || !isAuthReady) return;

    const postsQuery = collection(db, `/artifacts/${appId}/public/data/posts`);
    const unsubscribe = onSnapshot(postsQuery, (snapshot) => {
      const postsData = snapshot.docs.map(doc => {
        const post = { id: doc.id, ...doc.data() };
        // Fetch comments for each post
        const commentsQuery = collection(db, `/artifacts/${appId}/public/data/posts/${post.id}/comments`);
        onSnapshot(commentsQuery, (commentSnapshot) => {
          const commentsData = commentSnapshot.docs.map(commentDoc => ({
            id: commentDoc.id,
            ...commentDoc.data(),
          }));
          // Sort comments so replies are nested under their parents
          const sortedComments = commentsData.filter(c => !c.parentCommentId);
          sortedComments.forEach(comment => {
            comment.replies = commentsData.filter(c => c.parentCommentId === comment.id);
          });
          setPosts(prevPosts =>
            prevPosts.map(p =>
              p.id === post.id ? { ...p, comments: sortedComments } : p
            ).sort((a,b) => b.createdAt?.toDate() - a.createdAt?.toDate()) // Sort by most recent
          );
        });
        return post;
      });
      setPosts(postsData.sort((a,b) => b.createdAt?.toDate() - a.createdAt?.toDate())); // Initial sort
    }, (error) => {
      console.error("Error fetching posts:", error);
      showModal("Error loading posts. Please refresh the page.");
    });

    return () => unsubscribe();
  }, [db, isAuthReady]);

  // --- Post & Comment Handlers ---
  const handlePostSubmit = async (e) => {
    e.preventDefault();
    if (!user || !db || !postContent.trim()) {
      showModal('Please write something to post.');
      return;
    }
    const postsRef = collection(db, `/artifacts/${appId}/public/data/posts`);
    await addDoc(postsRef, {
      userId: user.uid,
      authorName: user.displayName || 'Anonymous',
      content: postContent,
      createdAt: new Date(),
      likes: 0,
      dislikes: 0,
      likers: [],
      dislikers: [],
    });
    setPostContent('');
  };

  const handlePostDelete = async (postId) => {
    if (!user || !db) return;
    const postRef = doc(db, `/artifacts/${appId}/public/data/posts`, postId);
    await deleteDoc(postRef);
  };

  const handleCommentSubmit = async (e, postId, parentCommentId = null) => {
    e.preventDefault();
    if (!user || !db) return;
    const content = e.target.comment.value;
    if (!content.trim()) return;

    const commentsRef = collection(db, `/artifacts/${appId}/public/data/posts/${postId}/comments`);
    await addDoc(commentsRef, {
      userId: user.uid,
      authorName: user.displayName || 'Anonymous',
      content,
      createdAt: new Date(),
      likes: 0,
      dislikes: 0,
      likers: [],
      dislikers: [],
      parentCommentId,
    });
    e.target.comment.value = '';
  };

  const handleCommentDelete = async (postId, commentId) => {
    if (!user || !db) return;
    const commentRef = doc(db, `/artifacts/${appId}/public/data/posts/${postId}/comments`, commentId);
    await deleteDoc(commentRef);
  };

  // --- Like/Dislike Handlers ---
  const handleVote = async (target, targetId, voteType, postId = null) => {
    if (!user || !db) {
      showModal('You must be signed in to like or dislike.');
      return;
    }

    const ref = target === 'post'
      ? doc(db, `/artifacts/${appId}/public/data/posts`, targetId)
      : doc(db, `/artifacts/${appId}/public/data/posts/${postId}/comments`, targetId);

    const likersKey = 'likers';
    const dislikersKey = 'dislikers';

    const userId = user.uid;

    const docSnapshot = await getDocs(query(collection(db, `/artifacts/${appId}/public/data/posts`), where('__name__', '==', targetId)));

    if (docSnapshot.empty) {
        showModal('Error: Document not found.');
        return;
    }

    const data = docSnapshot.docs[0].data();
    const likers = data[likersKey] || [];
    const dislikers = data[dislikersKey] || [];

    let newLikes = data.likes;
    let newDislikes = data.dislikes;

    // Remove vote if user has already voted
    const liked = likers.includes(userId);
    const disliked = dislikers.includes(userId);

    if (voteType === 'like') {
      if (liked) {
        // Already liked, remove like
        const updatedLikers = likers.filter(id => id !== userId);
        newLikes--;
        await updateDoc(ref, { [likersKey]: updatedLikers, likes: newLikes });
      } else {
        // Not liked, add like
        const updatedLikers = [...likers, userId];
        newLikes++;
        await updateDoc(ref, { [likersKey]: updatedLikers, likes: newLikes });

        // If disliked, remove dislike
        if (disliked) {
          const updatedDislikers = dislikers.filter(id => id !== userId);
          newDislikes--;
          await updateDoc(ref, { [dislikersKey]: updatedDislikers, dislikes: newDislikes });
        }
      }
    } else { // voteType === 'dislike'
      if (disliked) {
        // Already disliked, remove dislike
        const updatedDislikers = dislikers.filter(id => id !== userId);
        newDislikes--;
        await updateDoc(ref, { [dislikersKey]: updatedDislikers, dislikes: newDislikes });
      } else {
        // Not disliked, add dislike
        const updatedDislikers = [...dislikers, userId];
        newDislikes++;
        await updateDoc(ref, { [dislikersKey]: updatedDislikers, dislikes: newDislikes });

        // If liked, remove like
        if (liked) {
          const updatedLikers = likers.filter(id => id !== userId);
          newLikes--;
          await updateDoc(ref, { [likersKey]: updatedLikers, likes: newLikes });
        }
      }
    }
  };

  // --- UI Components ---
  const RippleButton = ({ children, onClick, className = '' }) => {
    return (
      <button
        onClick={onClick}
        className={`ripple-button relative overflow-hidden transition-all duration-300 transform active:scale-95 ${className}`}
      >
        {children}
      </button>
    );
  };

  const Modal = ({ message, isOpen, onClose }) => {
    if (!isOpen) return null;
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full">
          <p className="text-center text-lg font-semibold mb-4 text-gray-800">{message}</p>
          <div className="flex justify-center">
            <button
              onClick={onClose}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700 transition duration-200 ripple-button"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    );
  };

  const PostForm = () => (
    <form onSubmit={handlePostSubmit} className="bg-white p-6 rounded-xl shadow-lg mb-6 max-w-2xl w-full mx-auto">
      <h2 className="text-xl font-bold mb-4 text-gray-800">Create a Post</h2>
      <textarea
        className="w-full p-4 border rounded-xl bg-gray-50 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        rows="4"
        placeholder="What's on your mind?"
        value={postContent}
        onChange={(e) => setPostContent(e.target.value)}
      ></textarea>
      <RippleButton
        type="submit"
        className="w-full mt-4 bg-blue-600 text-white font-semibold py-3 rounded-xl shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        Post
      </RippleButton>
    </form>
  );

  const CommentSection = ({ postId, comments }) => {
    const renderComment = (comment) => (
      <div key={comment.id} className="mt-4 p-4 rounded-xl bg-gray-100 shadow-sm border border-gray-200">
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <p className="font-semibold text-gray-800">{comment.authorName}</p>
            <p className="text-sm text-gray-500">{formatDate(comment.createdAt)}</p>
            <p className="mt-2 text-gray-700">{comment.content}</p>
          </div>
          {user && comment.userId === user.uid && (
            <button onClick={() => handleCommentDelete(postId, comment.id)} className="text-red-500 hover:text-red-700 ml-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
        <div className="flex items-center space-x-4 mt-2">
          <RippleButton onClick={() => handleVote('comment', comment.id, 'like', postId)} className="flex items-center text-green-600 hover:text-green-700">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2 10.5a.5.5 0 01.5-.5h5a.5.5 0 010 1h-5a.5.5 0 01-.5-.5zM10 16a.5.5 0 01-.5-.5v-10a.5.5 0 011 0v10a.5.5 0 01-.5.5z" transform="rotate(45 10 10.5)" />
            </svg>
            <span className="ml-1">{comment.likes}</span>
          </RippleButton>
          <RippleButton onClick={() => handleVote('comment', comment.id, 'dislike', postId)} className="flex items-center text-red-600 hover:text-red-700">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2 10.5a.5.5 0 01.5-.5h5a.5.5 0 010 1h-5a.5.5 0 01-.5-.5zM10 16a.5.5 0 01-.5-.5v-10a.5.5 0 011 0v10a.5.5 0 01-.5.5z" transform="rotate(-45 10 10.5)" />
            </svg>
            <span className="ml-1">{comment.dislikes}</span>
          </RippleButton>
        </div>
        <div className="pl-6 mt-4 border-l-2 border-gray-300">
          {comment.replies && comment.replies.map(renderComment)}
        </div>
        <form onSubmit={(e) => handleCommentSubmit(e, postId, comment.id)} className="mt-2 flex">
          <input
            type="text"
            name="comment"
            className="flex-1 p-2 text-sm border rounded-xl bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="Reply..."
          />
          <RippleButton type="submit" className="ml-2 px-4 py-2 bg-blue-500 text-white rounded-xl text-sm hover:bg-blue-600">Reply</RippleButton>
        </form>
      </div>
    );

    return (
      <div className="mt-4">
        <h3 className="text-lg font-semibold text-gray-800">Comments</h3>
        <form onSubmit={(e) => handleCommentSubmit(e, postId)} className="mt-2 flex">
          <input
            type="text"
            name="comment"
            className="flex-1 p-2 border rounded-xl bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="Add a comment..."
          />
          <RippleButton type="submit" className="ml-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700">Comment</RippleButton>
        </form>
        {comments && comments.map(comment => renderComment(comment))}
      </div>
    );
  };

  if (loading || !isAuthReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 rounded-full animate-spin border-4 border-solid border-blue-500 border-t-transparent"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 font-sans p-4 flex flex-col items-center">
      <style>{rippleEffectCss}</style>
      <div className="w-full max-w-2xl bg-white p-6 rounded-xl shadow-lg mb-6 flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800">The Gemini Platform</h1>
        {user ? (
          <div className="flex items-center space-x-4">
            <span className="font-medium text-gray-700">Hello, {user.displayName || 'User'}!</span>
            <RippleButton onClick={handleSignOut} className="px-4 py-2 bg-red-500 text-white rounded-xl shadow-md hover:bg-red-600">Sign Out</RippleButton>
          </div>
        ) : (
          <RippleButton onClick={handleGoogleSignIn} className="px-4 py-2 bg-blue-600 text-white rounded-xl shadow-md hover:bg-blue-700">Sign In with Google</RippleButton>
        )}
      </div>

      {user && <PostForm />}

      <div className="w-full max-w-2xl">
        {posts.length > 0 ? (
          posts.map(post => (
            <div key={post.id} className="bg-white p-6 rounded-xl shadow-lg mb-6">
              <div className="flex justify-between items-start mb-4">
                <div className="flex-1">
                  <h2 className="text-lg font-bold text-gray-800">{post.authorName}</h2>
                  <p className="text-sm text-gray-500">{formatDate(post.createdAt)}</p>
                  <p className="mt-2 text-gray-700">{post.content}</p>
                </div>
                {user && post.userId === user.uid && (
                  <RippleButton onClick={() => handlePostDelete(post.id)} className="text-red-500 hover:text-red-700 ml-4">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </RippleButton>
                )}
              </div>
              <div className="flex items-center space-x-6">
                <RippleButton onClick={() => handleVote('post', post.id, 'like')} className="flex items-center text-green-600 hover:text-green-700">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M2 10.5a.5.5 0 01.5-.5h5a.5.5 0 010 1h-5a.5.5 0 01-.5-.5zM10 16a.5.5 0 01-.5-.5v-10a.5.5 0 011 0v10a.5.5 0 01-.5.5z" transform="rotate(45 10 10.5)" />
                  </svg>
                  <span className="ml-1 text-base">{post.likes}</span>
                </RippleButton>
                <RippleButton onClick={() => handleVote('post', post.id, 'dislike')} className="flex items-center text-red-600 hover:text-red-700">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M2 10.5a.5.5 0 01.5-.5h5a.5.5 0 010 1h-5a.5.5 0 01-.5-.5zM10 16a.5.5 0 01-.5-.5v-10a.5.5 0 011 0v10a.5.5 0 01-.5.5z" transform="rotate(-45 10 10.5)" />
                  </svg>
                  <span className="ml-1 text-base">{post.dislikes}</span>
                </RippleButton>
              </div>
              <CommentSection postId={post.id} comments={post.comments} />
            </div>
          ))
        ) : (
          <p className="text-center text-gray-500 mt-10">No posts yet. Be the first to post!</p>
        )}
      </div>

      <Modal message={modalMessage} isOpen={isModalOpen} onClose={closeModal} />
    </div>
  );
}
