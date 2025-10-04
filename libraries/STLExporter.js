/**
 * @author mrdoob / http://mrdoob.com/
 */

( function () {

	class STLExporter {

		parse( scene, options = {} ) {

			const { binary = false, space = ' ' } = options;

			//

			const triangles = 0;
			let objects = 0;
			let output = '';

			const vertex = new THREE.Vector3();
			const normal = new THREE.Vector3();

			//

			if ( binary === true ) {

				console.warn( 'THREE.STLExporter: Binary export is not supported at the moment.' );
				return null;

			} else {

				output = 'solid exported\n';

			}

			scene.traverse( function ( object ) {

				if ( object.isMesh ) {

					const geometry = object.geometry;
					const matrixWorld = object.matrixWorld;

					let count = 0;
					let attributes;
					let index;
					let i, l;

					if ( geometry.isGeometry ) {

						geometry.computeFaceNormals();
						attributes = geometry.vertices;
						index = geometry.faces;
						count = index.length;

					} else if ( geometry.isBufferGeometry ) {

						if ( geometry.index !== null ) {

							index = geometry.index.array;
							count = index.length / 3;

						} else {

							index = geometry.attributes.position.array;
							count = index.length / 9;

						}

						attributes = geometry.attributes.position.array;

					}

					for ( i = 0, l = count; i < l; i ++ ) {

						if ( geometry.isGeometry ) {

							const face = index[ i ];

							output += '\tfacet normal ' + face.normal.x + space + face.normal.y + space + face.normal.z + '\n';
							output += '\t\touter loop\n';

							let vertices = [ face.a, face.b, face.c ];

							for ( let j = 0; j < 3; j ++ ) {

								vertex.copy( attributes[ vertices[ j ] ] ).applyMatrix4( matrixWorld );

								output += '\t\t\tvertex ' + vertex.x + space + vertex.y + space + vertex.z + '\n';

							}

							output += '\t\tendloop\n';
							output += '\tendfacet\n';

						} else {

							let faceNormal;

							if ( geometry.index !== null ) {

								const vA = index[ i * 3 + 0 ] * 3;
								const vB = index[ i * 3 + 1 ] * 3;
								const vC = index[ i * 3 + 2 ] * 3;

								const pA = new THREE.Vector3( attributes[ vA ], attributes[ vA + 1 ], attributes[ vA + 2 ] ).applyMatrix4( matrixWorld );
								const pB = new THREE.Vector3( attributes[ vB ], attributes[ vB + 1 ], attributes[ vB + 2 ] ).applyMatrix4( matrixWorld );
								const pC = new THREE.Vector3( attributes[ vC ], attributes[ vC + 1 ], attributes[ vC + 2 ] ).applyMatrix4( matrixWorld );

								pC.sub( pB );
								pA.sub( pB );
								pC.cross( pA );

								faceNormal = pC.normalize();

							} else {

								faceNormal = object.geometry.attributes.normal.array.slice( i * 3, i * 3 + 3 );
								faceNormal = new THREE.Vector3( faceNormal[ 0 ], faceNormal[ 1 ], faceNormal[ 2 ] );

							}

							output += '\tfacet normal ' + faceNormal.x + space + faceNormal.y + space + faceNormal.z + '\n';
							output += '\t\touter loop\n';

							for ( let j = 0; j < 3; j ++ ) {

								let vertexIndex = i * 9 + j * 3;

								vertex.set( attributes[ vertexIndex ], attributes[ vertexIndex + 1 ], attributes[ vertexIndex + 2 ] ).applyMatrix4( matrixWorld );

								output += '\t\t\tvertex ' + vertex.x + space + vertex.y + space + vertex.z + '\n';

							}

							output += '\t\tendloop\n';
							output += '\tendfacet\n';

						}

					}

					objects ++;

				}

			} );

			output += 'endsolid exported\n';

			return output;

		}

	}

	THREE.STLExporter = STLExporter;

} )();